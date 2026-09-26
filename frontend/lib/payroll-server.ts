/**
 * Server-only backend for the payroll demo frontend.
 *
 * Architecture note: Midnight SDK code must NOT be bundled by Next.js —
 * mixed ESM/CJS module instantiation breaks wasm class identity
 * ("expected instance of StateValue/ChargedState"). Instead, API routes
 * spawn the root project's `tsx` scripts as child processes (plain Node,
 * single module instances — the same runtime the CLI uses) and parse the
 * JSON they print. This mirrors upstream Midnight Next.js examples.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Locate the project root (holds scripts/, .midnight-state.json, caches). */
function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
      if (pkg?.name === "payroll") return dir;
    } catch {
      /* keep walking up */
    }
    dir = path.dirname(dir);
  }
  return path.resolve(process.cwd(), "..");
}

export const PROJECT_ROOT = findProjectRoot();

async function runScript(name: string, args: string[], timeoutMs: number): Promise<any> {
  let stdout = "";
  try {
    const res = await execFileAsync("npx", ["tsx", `scripts/${name}`, ...args], {
      cwd: PROJECT_ROOT,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env },
    });
    stdout = res.stdout;
  } catch (e: any) {
    // Scripts print `{ok:false,…}` JSON before exiting non-zero — surface it.
    stdout = e?.stdout ?? "";
    if (!stdout.trim()) throw new Error(`${name} failed: ${(e?.message ?? e).toString().slice(0, 300)}`);
  }
  const lastLine = stdout.trim().split("\n").pop() ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    throw new Error(`${name} produced no JSON output. Raw tail: ${lastLine.slice(0, 300)}`);
  }
  if (!parsed.ok) throw new Error(parsed.error || `${name} failed`);
  return parsed;
}

// Simple FIFO mutex so concurrent API calls don't interleave wallet tx flows
// (one demo wallet — one transaction at a time).
let lock: Promise<void> = Promise.resolve();
export async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = lock;
  let release!: () => void;
  lock = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

// ─── Reads (fast, no wallet sync) ────────────────────────────────────────────

export async function readLedger() {
  const parsed = await runScript("payroll-ledger.ts", [], 60_000);
  return parsed.ledger;
}

export async function listOpenings() {
  const parsed = await runScript("payroll-openings.ts", [], 60_000);
  return parsed.openings;
}

export async function getStatus() {
  const parsed = await runScript("payroll-status.ts", [], 180_000);
  return parsed.status;
}

// ─── Writes (wallet sync + ZK proving; can take minutes) ────────────────────

const WRITE_TIMEOUT = 290_000;

export async function registerEmployee(salary: bigint) {
  return withLock(async () => {
    const parsed = await runScript("payroll-register.ts", [salary.toString()], WRITE_TIMEOUT);
    return parsed;
  });
}

export async function claimSalary(id: bigint, salary: bigint, nonceHex: string) {
  return withLock(async () => {
    const parsed = await runScript(
      "payroll-claim.ts",
      [id.toString(), salary.toString(), nonceHex.trim()],
      WRITE_TIMEOUT,
    );
    return parsed;
  });
}

export async function runBatch(tag: string) {
  return withLock(async () => {
    const parsed = await runScript("payroll-batch.ts", [tag], WRITE_TIMEOUT);
    return parsed;
  });
}
