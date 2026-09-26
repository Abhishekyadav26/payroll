import { NextResponse } from "next/server";
import { listOpenings } from "@/lib/payroll-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Demo key-management: openings the local wallet created, joined with
 * on-chain claimed flags. In production these travel employer → employee
 * off-chain (encrypted), never through an API.
 */
export async function GET() {
  try {
    const openings = await listOpenings();
    return NextResponse.json({ ok: true, openings });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
