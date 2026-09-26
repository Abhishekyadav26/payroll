/** Register employee: payroll-register.ts <salary> → JSON on stdout. */
import { randomBytes } from 'node:crypto';
import { getTxCtx, readLedger, loadAllocations, saveAllocations, out, failOut } from './payroll-lib.js';

const salary = BigInt(process.argv[2] ?? '');
if (salary < 0n) failOut('Salary must be >= 0.');

try {
  const ctx = await getTxCtx();
  const nonce = randomBytes(32);
  const tx = await ctx.deployed.callTx.registerEmployee(salary, new Uint8Array(nonce));
  const ledger = await readLedger();
  const id = (BigInt(ledger.employeeCount) - 1n).toString();
  const entry = ledger.entries.find((e: { id: string }) => e.id === id);
  const allos = loadAllocations();
  allos.push({ id, salary: salary.toString(), nonceHex: nonce.toString('hex'), claimed: false });
  saveAllocations(allos);
  await ctx.walletCtx.wallet.stop();
  out({
    ok: true, id, salary: salary.toString(), nonceHex: nonce.toString('hex'),
    commitment: entry?.commitment ?? null,
    txId: tx.public.txId as string, blockHeight: String(tx.public.blockHeight),
  });
} catch (e) {
  failOut(e instanceof Error ? e.message : String(e));
}
process.exit(0);
