"use client";

import { useCallback, useEffect, useState } from "react";

interface Opening {
  id: string;
  salary: string;
  nonceHex: string;
  claimed: boolean;
}

export default function EmployeePage() {
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [id, setId] = useState("");
  const [salary, setSalary] = useState("");
  const [nonceHex, setNonceHex] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/openings");
      const j = await r.json();
      if (j.ok) setOpenings(j.openings);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function claim(o: { id: string; salary: string; nonceHex: string }) {
    setBusy(`claim-${o.id}`);
    setError(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(o),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setOkMsg(`✅ Salary for id=${o.id} claimed at block ${j.blockHeight} (tx ${j.txId}). Amount never left your machine in the clear — only a ZK proof went on-chain.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1>🧑 Employee</h1>
      <p className="muted">
        Claim your salary by proving knowledge of your secret <span className="mono">(salary, nonce)</span> opening.
        A wrong opening is rejected by the contract — try it and see.
      </p>

      <div className="panel">
        <h3>Your openings (demo key-management)</h3>
        <p className="muted">In production these arrive encrypted, off-chain. Here they are listed because both roles share the demo wallet.</p>
        {openings.length === 0 ? (
          <p className="muted">No openings yet — ask the employer to register you first.</p>
        ) : (
          <table>
            <thead>
              <tr><th>ID</th><th>Salary (only you see this)</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {openings.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.id}</td>
                  <td className="mono">{o.salary}</td>
                  <td>{o.claimed ? <span className="badge claimed">claimed</span> : <span className="badge pending">unclaimed</span>}</td>
                  <td>
                    <button className="ghost" disabled={o.claimed || busy !== null} onClick={() => claim(o)}>
                      {busy === `claim-${o.id}` ? "Proving…" : o.claimed ? "Done" : "Claim"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>Manual claim (paste an opening)</h3>
        <div className="row">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Employee id" />
          <input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="Salary" />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input value={nonceHex} onChange={(e) => setNonceHex(e.target.value)} placeholder="Nonce hex (64 chars)" className="mono" />
          <button disabled={busy !== null} onClick={() => claim({ id, salary, nonceHex })}>
            {busy ? "Proving…" : "Claim"}
          </button>
        </div>
      </div>

      {okMsg && <div className="alert success">{okMsg}</div>}
      {error && <div className="alert error">❌ Claim rejected: {error}</div>}
      {busy && <div className="alert info"><span className="spinner" />Generating ZK proof — ~30–90s on a devnet.</div>}
    </div>
  );
}
