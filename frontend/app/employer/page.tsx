"use client";

import { useCallback, useEffect, useState } from "react";

interface Status {
  network: string;
  contractAddress: string | null;
  walletReady: boolean;
  balance: string | null;
}

interface RegisterResult {
  id: string;
  salary: string;
  nonceHex: string;
  commitment: string | null;
  txId: string;
  blockHeight: string;
}

export default function EmployerPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [salary, setSalary] = useState("5000");
  const [tag, setTag] = useState("2026-09-payroll");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [batchResult, setBatchResult] = useState<{ tag: string; txId: string; blockHeight: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/status");
      const j = await r.json();
      if (j.ok) setStatus(j.status);
    } catch {
      /* dev server may still be starting */
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 15000);
    return () => clearInterval(t);
  }, [loadStatus]);

  async function register() {
    setBusy("register");
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salary }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setResult(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runBatch() {
    setBusy("batch");
    setError(null);
    setBatchResult(null);
    try {
      const r = await fetch("/api/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setBatchResult(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1>💼 Employer</h1>
      <p className="muted">
        Register employees with <b>private</b> salaries — only a commitment hash lands on-chain —
        and anchor public batch tags for auditors.
      </p>

      <div className="panel">
        <h3>Connection</h3>
        {!status ? (
          <p className="muted"><span className="spinner" />Connecting to devnet…</p>
        ) : (
          <div className="mono">
            network: {status.network} · contract: {status.contractAddress?.slice(0, 20)}… ·{" "}
            wallet: {status.walletReady ? <span className="status-ok">ready</span> : <span className="status-warn">syncing (first write warms it up)</span>}
            {status.balance !== null && <> · balance: {Number(status.balance).toLocaleString()} tNight</>}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>1 · Register employee</h3>
        <div className="row">
          <input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="Salary amount, e.g. 5000" inputMode="numeric" />
          <button onClick={register} disabled={busy !== null}>
            {busy === "register" ? <><span className="spinner" />Proving…</> : "Register (private)"}
          </button>
        </div>
        <p className="muted">A fresh random nonce is generated per employee. Both stay off-ledger.</p>
        {result && (
          <div className="alert success">
            ✅ Employee <b>id={result.id}</b> registered at block {result.blockHeight}
            <br />
            <span className="mono">commitment: {result.commitment}</span>
            <br />
            <span className="mono">tx: {result.txId}</span>
            <br />
            Opening saved for the demo — hand <span className="mono">salary={result.salary}</span> + <span className="mono">nonce={result.nonceHex.slice(0, 16)}…</span> to the employee off-chain.
          </div>
        )}
      </div>

      <div className="panel">
        <h3>2 · Run payroll batch</h3>
        <div className="row">
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. 2026-09-payroll" />
          <button onClick={runBatch} disabled={busy !== null}>
            {busy === "batch" ? <><span className="spinner" />Proving…</> : "Anchor batch"}
          </button>
        </div>
        {batchResult && (
          <div className="alert success">
            ✅ Batch <b>“{batchResult.tag}”</b> anchored at block {batchResult.blockHeight}
            <br />
            <span className="mono">tx: {batchResult.txId}</span>
          </div>
        )}
      </div>

      {error && <div className="alert error">❌ {error}</div>}
      {busy && <div className="alert info"><span className="spinner" />Generating ZK proof and submitting — this takes ~30–90s on a devnet. Hang tight.</div>}
    </div>
  );
}
