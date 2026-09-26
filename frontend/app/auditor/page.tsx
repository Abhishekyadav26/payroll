"use client";

import { useCallback, useEffect, useState } from "react";

interface LedgerEntry {
  id: string;
  commitment: string;
  claimed: boolean;
}

interface Ledger {
  network: string;
  contractAddress: string;
  owner: string;
  employeeCount: string;
  batchCount: string;
  batchTag: string;
  entries: LedgerEntry[];
}

export default function AuditorPage() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const r = await fetch("/api/ledger");
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setLedger(j.ledger);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <h1>🔍 Auditor</h1>
      <p className="muted">
        Everything below is <b>public</b> on the Midnight ledger. Notice what is missing:
        <b> no salary amounts anywhere</b> — only opaque commitment hashes.
      </p>

      <div className="panel">
        <div className="row">
          <button className="ghost" onClick={load} disabled={refreshing}>{refreshing ? "Refreshing…" : "↻ Refresh"}</button>
        </div>
        {error && <div className="alert error">❌ {error}</div>}
        {!ledger && !error && <p className="muted"><span className="spinner" />Reading contract state…</p>}
        {ledger && (
          <>
            <table>
              <tbody>
                <tr><th>Network</th><td className="mono">{ledger.network}</td></tr>
                <tr><th>Contract</th><td className="mono">{ledger.contractAddress}</td></tr>
                <tr><th>Owner (public id)</th><td className="mono">{ledger.owner.slice(0, 32)}…</td></tr>
                <tr><th>Employees</th><td><b>{ledger.employeeCount}</b></td></tr>
                <tr><th>Batches</th><td><b>{ledger.batchCount}</b> (latest: “{ledger.batchTag}”)</td></tr>
              </tbody>
            </table>

            <h3 style={{ marginTop: 20 }}>Commitments — hashes only, amounts not visible</h3>
            {ledger.entries.length === 0 ? (
              <p className="muted">No employees registered yet.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>ID</th><th>Commitment (truncated)</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {ledger.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="mono">{e.id}</td>
                      <td className="mono">{e.commitment.slice(0, 32)}…</td>
                      <td>{e.claimed ? <span className="badge claimed">claimed</span> : <span className="badge pending">unclaimed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <div className="alert info">
        Trust model: the auditor can verify <b>headcount</b>, <b>claim status</b>, and <b>batch schedule</b> —
        but must take amounts on faith (or via selective disclosure off-chain). Settlement of real value is out of scope for this demo.
      </div>
    </div>
  );
}
