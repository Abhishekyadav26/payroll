import { NextResponse } from "next/server";
import { registerEmployee } from "@/lib/payroll-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Proof generation + submission can take ~60s on a devnet.
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const salary = BigInt(String(body.salary));
    if (salary < 0n) throw new Error("Salary must be >= 0.");
    const result = await registerEmployee(salary);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
