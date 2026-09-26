import { NextResponse } from "next/server";
import { runBatch } from "@/lib/payroll-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tag = String(body.tag ?? "").trim();
    if (!tag) throw new Error("Batch tag is required.");
    const result = await runBatch(tag);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
