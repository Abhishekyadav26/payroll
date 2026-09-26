/**
 * Shared backend for the payroll scripts (CLI + frontend API under the hood).
 *
 * These run under plain `tsx` (no bundler), so every Midnight module resolves
 * to a single instance — no wasm class-identity issues.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { resolveNetwork, getOrCreateWallet, getDeployment } from '../src/network.js';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from '../src/wallet.js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

export const PRIVATE_STATE_ID = 'payrollPrivateState';

export const { network: NETWORK, config: NETWORK_CONFIG } = resolveNetwork();
const CREDS = getOrCreateWallet(NETWORK);
export const SEED = CREDS.seed;

export function ownerKeyBytes(): Uint8Array {
  const raw = Buffer.from(SEED, 'hex');
  const out = new Uint8Array(32);
  out.set(raw.subarray(0, 32));
  return out;
}
const OWNER_KEY = ownerKeyBytes();
export const witnesses = {
  ownerKey: (ctx: any) => [ctx?.privateState ?? {}, OWNER_KEY] as const,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ZK_CONFIG_PATH = path.resolve(__dirname, '..', 'contracts', 'managed', 'payroll');

export async function loadCompiled() {
  const contractFile = path.join(ZK_CONFIG_PATH, 'contract', 'index.js');
  if (!fs.existsSync(contractFile)) throw new Error('Contract not compiled. Run: npm run compile');
  const Payroll = await import(pathToFileURL(contractFile).href);
  const CC = CompiledContract as any;
  const compiledContract = CC.make('payroll', Payroll.Contract).pipe(
    CC.withWitnesses(witnesses),
    CC.withCompiledFileAssets(ZK_CONFIG_PATH),
  );
  return { Payroll, compiledContract };
}

export function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

export async function readLedger() {
  const deployment = getDeployment(NETWORK);
  if (!deployment) throw new Error(`No deployment on file for network ${NETWORK}.`);
  const { Payroll } = await loadCompiled();
  const pdp = indexerPublicDataProvider(NETWORK_CONFIG.indexer, NETWORK_CONFIG.indexerWS);
  const cs = await pdp.queryContractState(deployment.address);
  if (!cs) throw new Error('Contract state not indexed yet.');
  const ledger = Payroll.ledger(cs.data);
  const entries = [];
  for (const [id, comm] of ledger.commitments as Iterable<[bigint, Uint8Array]>) {
    const claimed = ledger.claimed as unknown as { member(k: bigint): boolean; lookup(k: bigint): boolean };
    entries.push({ id: id.toString(), commitment: toHex(comm), claimed: claimed.member(id) ? claimed.lookup(id) : false });
  }
  entries.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
  return {
    network: NETWORK,
    contractAddress: deployment.address,
    owner: toHex(ledger.owner as Uint8Array),
    employeeCount: (ledger.employeeCount as bigint).toString(),
    batchCount: (ledger.batchCount as bigint).toString(),
    batchTag: ledger.batchTag as string,
    entries,
  };
}

export interface TxCtx {
  Payroll: any;
  walletCtx: WalletContext;
  providers: any;
  deployed: any;
  contractAddress: string;
}

export async function getTxCtx(): Promise<TxCtx> {
  const deployment = getDeployment(NETWORK);
  if (!deployment) throw new Error(`No deployment on file for network ${NETWORK}.`);
  const { Payroll, compiledContract } = await loadCompiled();
  const walletCtx = await createWallet({ network: NETWORK, networkConfig: NETWORK_CONFIG, seed: SEED });
  await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(NETWORK, walletCtx);
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
  const zkConfigProvider = new NodeZkConfigProvider(ZK_CONFIG_PATH);
  const providers: any = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'payroll-state',
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(NETWORK_CONFIG.indexer, NETWORK_CONFIG.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(NETWORK_CONFIG.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
  const deployed: any = await findDeployedContract(providers, {
    compiledContract,
    contractAddress: deployment.address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
  });
  return { Payroll, walletCtx, providers, deployed, contractAddress: deployment.address };
}

export interface Allocation {
  id: string;
  salary: string;
  nonceHex: string;
  claimed: boolean;
}

export function allocationsPath(): string {
  return path.resolve(process.cwd(), `.payroll-allocations.${NETWORK}.json`);
}

export function loadAllocations(): Allocation[] {
  try {
    const p = allocationsPath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Allocation[];
  } catch {
    return [];
  }
}

export function saveAllocations(allos: Allocation[]): void {
  fs.writeFileSync(allocationsPath(), `${JSON.stringify(allos, null, 2)}\n`, { mode: 0o600 });
}

/** Print final JSON to stdout (keep stdout clean — progress goes to stderr). */
export function out(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

export function failOut(msg: string): never {
  out({ ok: false, error: msg });
  process.exit(1);
}

export { unshieldedToken };
