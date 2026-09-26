/** Openings (demo key-management) joined with on-chain flags → JSON on stdout. */
import { loadAllocations, readLedger, out, failOut } from './payroll-lib.js';

try {
  const openings = loadAllocations();
  let claimedById: Record<string, boolean> = {};
  try {
    const ledger = await readLedger();
    for (const e of ledger.entries) claimedById[e.id] = e.claimed;
  } catch {
    /* fall back to local flags */
  }
  out({ ok: true, openings: openings.map((o) => ({ ...o, claimed: claimedById[o.id] ?? o.claimed })) });
} catch (e) {
  failOut(e instanceof Error ? e.message : String(e));
}
process.exit(0);
