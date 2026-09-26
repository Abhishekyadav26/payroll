/** Wallet/network status → JSON on stdout. */
import { NETWORK, NETWORK_CONFIG, SEED, out, failOut, unshieldedToken } from './payroll-lib.js';
import { getDeployment } from '../src/network.js';
import { createWallet } from '../src/wallet.js';

try {
  const deployment = getDeployment(NETWORK);
  const walletCtx = await createWallet({ network: NETWORK, networkConfig: NETWORK_CONFIG, seed: SEED });
  const s = await walletCtx.wallet.waitForSyncedState();
  const balance = (s.unshielded.balances[unshieldedToken().raw] ?? 0n).toString();
  await walletCtx.wallet.stop();
  out({
    ok: true,
    status: {
      network: NETWORK,
      contractAddress: deployment?.address ?? null,
      walletReady: true,
      balance,
      indexer: NETWORK_CONFIG.indexer,
    },
  });
} catch (e) {
  failOut(e instanceof Error ? e.message : String(e));
}
process.exit(0);
