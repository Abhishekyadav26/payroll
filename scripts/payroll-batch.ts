/** Anchor batch: payroll-batch.ts <tag> → JSON on stdout. */
import { getTxCtx, out, failOut } from './payroll-lib.js';

const tag = (process.argv[2] ?? '').trim();
if (!tag) failOut('Batch tag is required.');

try {
  const ctx = await getTxCtx();
  const tx = await ctx.deployed.callTx.runBatch(tag);
  await ctx.walletCtx.wallet.stop();
  out({ ok: true, tag, txId: tx.public.txId as string, blockHeight: String(tx.public.blockHeight) });
} catch (e) {
  failOut(e instanceof Error ? e.message : String(e));
}
process.exit(0);
