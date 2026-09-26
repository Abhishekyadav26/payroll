/**
 * CLI for Private Payroll / Splits on Midnight.
 *
 * Flows:
 *  1. Register employee (employer): salary + random nonce stay private;
 *     only a commitment hash lands on ledger. Allocation saved locally so
 *     the employee can claim later (out-of-band in production).
 *  2. Claim salary (employee): prove (id, salary, nonce) opening in ZK;
 *     ledger flips claimed flag. Amount never revealed on-chain.
 *  3. Run payroll batch (employer): anchor a public batch tag for auditors.
 *  4. Auditor view: read public ledger — counters, commitments, flags, tag.
 *     NOTE: amounts are NOT visible here by design.
 *  5. Wallet balance.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { Buffer } from 'buffer';
import { randomBytes } from 'node:crypto';

// Midnight SDK imports
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'payrollPrivateState';

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

function ownerKeyBytes(): Uint8Array {
  const raw = Buffer.from(SEED, 'hex');
  const out = new Uint8Array(32);
  out.set(raw.subarray(0, 32));
  return out;
}
const OWNER_KEY = ownerKeyBytes();
const witnesses = {
  ownerKey: (ctx: any) => [ctx?.privateState ?? {}, OWNER_KEY] as const,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'payroll');

// Load compiled contract
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

// Check if contract is compiled
if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

const Payroll = await import(pathToFileURL(contractPath).href);

const CC = CompiledContract as any;
const compiledContract = CC.make('payroll', Payroll.Contract).pipe(
  CC.withWitnesses(witnesses),
  CC.withCompiledFileAssets(zkConfigPath),
);

// ─── Local allocation store (demo key-management) ────────────────────────────
// In production the (salary, nonce) opening travels employer → employee
// off-chain (encrypted). For this demo CLI both roles share one wallet, so we
// persist openings to a gitignored local file.

interface Allocation {
  id: string;
  salary: string;
  nonceHex: string;
  claimed: boolean;
}

function allocationsPath(): string {
  return path.resolve(__dirname, '..', `.payroll-allocations.${network}.json`);
}

function loadAllocations(): Allocation[] {
  try {
    const p = allocationsPath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Allocation[];
  } catch {
    return [];
  }
}

function saveAllocations(allos: Allocation[]): void {
  fs.writeFileSync(allocationsPath(), `${JSON.stringify(allos, null, 2)}\n`, { mode: 0o600 });
}

function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: WalletContext) {
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'payroll-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── Main CLI ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Private Payroll / Splits CLI                    ║');
  console.log('║   amounts stay shielded — ledger holds only commitments      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });

  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}. Run \`npm run setup -- --network ${network}\` first.`);
    process.exit(1);
    throw new Error('no deployment');
  }
  const contractAddress: string = deployment.address;
  console.log(`  Contract: ${deployment.address}`);
  console.log(`  Network: ${network}\n`);

  try {
    console.log('  Connecting to wallet...');
    const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
    const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
    if (restoredCount > 0) {
      console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
    }

    console.log('  Syncing with network...');
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');

    await persistWalletState(network, walletCtx);
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

    if (balance === 0n && network !== 'undeployed' && networkConfig.faucet) {
      const address = walletCtx.unshieldedKeystore.getBech32Address();
      console.log('  ⚠ Wallet has no tNight. Fund it from the faucet to send transactions:');
      console.log(`     ${networkConfig.faucet}`);
      console.log(`     Wallet address: ${address}\n`);
    }

    console.log('  Connecting to contract...');
    const providers = await createProviders(walletCtx);

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });

    console.log('  ✅ Connected!\n');

    async function readLedger(): Promise<any> {
      const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
      if (!contractState) throw new Error('contract state not found');
      return Payroll.ledger(contractState.data);
    }

    let running = true;
    while (running) {
      console.log('─── Menu ───────────────────────────────────────────────────────');
      console.log('  1. Register employee (employer, salary stays private)');
      console.log('  2. Claim salary (employee, ZK proof)');
      console.log('  3. Run payroll batch (employer, public anchor)');
      console.log('  4. Auditor view (public ledger — no amounts)');
      console.log('  5. Check wallet balance');
      console.log('  6. Exit\n');

      const choice = await rl.question('  Your choice: ');

      switch (choice.trim()) {
        case '1': {
          const salaryStr = await rl.question('  Salary amount (uint, e.g. 5000): ');
          const salary = BigInt(salaryStr.trim());
          if (salary < 0n) { console.log('\n  ❌ Salary must be >= 0\n'); break; }
          const nonce = randomBytes(32);
          const nonceArr = new Uint8Array(nonce);
          console.log('\n  Submitting registerEmployee (proving, 30-60s)...');
          console.log('  (salary + nonce remain private; only a commitment is stored)');
          try {
            const tx = await deployed.callTx.registerEmployee(salary, nonceArr);
            console.log(`\n  ✅ Employee registered. Tx: ${tx.public.txId} @ block ${tx.public.blockHeight}`);
            // Next id = current count (ids are 0-based sequential)
            const ledger = await readLedger();
            const id = (BigInt(ledger.employeeCount) - 1n).toString();
            const allos = loadAllocations();
            allos.push({ id, salary: salary.toString(), nonceHex: nonce.toString('hex'), claimed: false });
            saveAllocations(allos);
            console.log(`  Employee id: ${id} — opening saved to ${path.basename(allocationsPath())} (demo key-mgmt)\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '2': {
          const allos = loadAllocations();
          if (allos.length > 0) {
            console.log('\n  Saved openings (demo):');
            for (const a of allos) console.log(`    id=${a.id} salary=${a.salary} claimed=${a.claimed}`);
            console.log('');
          }
          const idStr = await rl.question('  Employee id: ');
          const salaryStr = await rl.question('  Salary amount: ');
          const nonceHex = await rl.question('  Nonce hex (32 bytes): ');
          try {
            const tx = await deployed.callTx.claim(BigInt(idStr.trim()), BigInt(salaryStr.trim()), new Uint8Array(Buffer.from(nonceHex.trim(), 'hex')));
            console.log(`\n  ✅ Salary claimed (ZK-verified, amount not revealed). Tx: ${tx.public.txId} @ block ${tx.public.blockHeight}\n`);
            const updated = loadAllocations().map((a) => (a.id === idStr.trim() ? { ...a, claimed: true } : a));
            saveAllocations(updated);
          } catch (error) {
            console.error('\n  ❌ Failed (wrong opening or already claimed?):', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '3': {
          const tag = await rl.question('  Batch tag (e.g. 2026-09-payroll): ');
          console.log('\n  Submitting runBatch...');
          try {
            const tx = await deployed.callTx.runBatch(tag.trim() || 'batch');
            console.log(`\n  ✅ Batch anchored: "${tag.trim()}" Tx: ${tx.public.txId} @ block ${tx.public.blockHeight}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '4': {
          console.log('\n  Reading public ledger (auditor view)...');
          try {
            const ledger = await readLedger();
            console.log(`\n  📋 batchTag: "${ledger.batchTag}"`);
            console.log(`  👥 employees: ${ledger.employeeCount}   batches: ${ledger.batchCount}`);
            console.log('  Commitments on ledger (hashes only — amounts NOT visible):');
            for (const [id, comm] of ledger.commitments as Iterable<[bigint, Uint8Array]>) {
              const flag = (ledger.claimed as any).member(id) ? (ledger.claimed as any).lookup(id) : false;
              console.log(`    id=${id} commitment=${toHex(comm as Uint8Array).slice(0, 32)}… claimed=${flag}`);
            }
            console.log('');
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '5': {
          console.log('\n  Checking balance...');
          const currentState = await walletCtx.wallet.waitForSyncedState();
          const currentBalance = currentState.unshielded.balances[unshieldedToken().raw] ?? 0n;
          const dustBalance = currentState.dust.balance(new Date());
          console.log(`\n  tNight: ${currentBalance.toLocaleString()}`);
          console.log(`  DUST: ${dustBalance.toLocaleString()}\n`);
          break;
        }

        case '6':
          running = false;
          console.log('\n  👋 Goodbye!\n');
          break;

        default:
          console.log('\n  ❌ Invalid choice. Please enter 1-6.\n');
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
  } finally {
    rl.close();
  }
}

main().catch(console.error);
