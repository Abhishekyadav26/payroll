/** Claim salary: payroll-claim.ts <id> <salary> <nonceHex> → JSON on stdout. */
import { Buffer } from 'node:buffer';
import { getTxCtx, loadAllocations, saveAllocations, out, failOut } from './payroll-lib.js';

const [idStr, salaryStr, nonceHex] = process.argv.slice(2);
try {
  const id = BigInt(idStr ?? '');
  const salary = BigInt(salaryStr ?? '');
  const nonce = new Uint8Array(Buffer.from((nonceHex ?? '').trim(), 'hex'));
  if (nonce.length !== 32) failOut('Nonce must be 32 bytes (64 hex chars).');
  const ctx = await getTxCtx();
  const tx = await ctx.deployed.callTx.claim(id, salary, nonce);
  saveAllocations(loadAllocations().map((a) => (a.id === id.toString() ? { ...a, claimed: true } : a)));
  await ctx.walletCtx.wallet.stop();
  out({ ok: true, txId: tx.public.txId as string, blockHeight: String(tx.public.blockHeight) });
} catch (e) {
  failOut(e instanceof Error ? e.message : String(e));
}
process.exit(0);
