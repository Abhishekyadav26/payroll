import { NextResponse } from "next/server";
import { readLedger } from "@/lib/payroll-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ledger = await readLedger();
    return NextResponse.json({ ok: true, ledger });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
