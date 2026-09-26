/** Read public payroll ledger → JSON on stdout. */
import { readLedger, out, failOut } from './payroll-lib.js';

try {
  const ledger = await readLedger();
  out({ ok: true, ledger });
} catch (e) {
  failOut(e instanceof Error ? e.message : String(e));
}
process.exit(0);
