export default function Home() {
  return (
    <div className="hero">
      <span className="pill">Midnight Network · shielded demo</span>
      <h1>Pay people without publishing paychecks.</h1>
      <p>
        Veiled Payroll splits funds across employees while keeping every amount private.
        Salaries enter the smart contract as zero-knowledge inputs — the public ledger
        carries only opaque commitments, claim flags, and batch anchors.
      </p>

      <div className="cards">
        <a className="card" href="/employer">
          <h3>💼 Employer</h3>
          <p>Register employees with private salaries and anchor payroll batches.</p>
          <span className="go">Open employer →</span>
        </a>
        <a className="card" href="/employee">
          <h3>🧑 Employee</h3>
          <p>Claim your salary by proving your secret opening — amount stays hidden.</p>
          <span className="go">Open employee →</span>
        </a>
        <a className="card" href="/auditor">
          <h3>🔍 Auditor</h3>
          <p>Inspect the public ledger: headcount, batches, commitments. No amounts.</p>
          <span className="go">Open auditor →</span>
        </a>
      </div>

      <div className="steps">
        <div className="step"><b>1.</b> Employer registers each employee with a <span className="mono">salary</span> + random <span className="mono">nonce</span>. Only <span className="mono">persistentCommit(salary, nonce)</span> is stored on-chain.</div>
        <div className="step"><b>2.</b> Employee claims by revealing the opening inside a ZK proof. The ledger flips a flag — the amount is never disclosed.</div>
        <div className="step"><b>3.</b> Employer anchors a batch tag (e.g. <span className="mono">2026-09-payroll</span>) so auditors can verify schedule and headcount without seeing pay.</div>
      </div>

      <p className="muted">
        Demo note: openings travel employer → employee off-chain in production.
        Here both roles share the demo wallet, so openings are listed on the employee page.
      </p>
    </div>
  );
}
