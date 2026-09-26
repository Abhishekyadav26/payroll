# Veiled Payroll — demo frontend

Next.js demo app for the Private Payroll / Splits contract: **Employer** registers
staff with shielded salaries, **Employee** claims via ZK proof, **Auditor** inspects
the public ledger (commitments only — no amounts).

All chain interaction runs in API routes (Node runtime) reusing the root project's
wallet + contract code (`../src`). Browser pages only ever see JSON.

## Run

From the project root, with the devnet up:

```bash
# Verifies against YOUR indexer (8089 here only because 8088 is squatted on this box)
export MIDNIGHT_INDEXER_URL=http://127.0.0.1:8089/api/v4/graphql
export MIDNIGHT_INDEXER_WS_URL=ws://127.0.0.1:8089/api/v4/graphql/ws
npm run frontend:dev
```

Then open http://localhost:3000.

> First write warms up the wallet (sync + DUST, a minute or two); proof
> generation per transaction takes ~30–90s on a devnet. The UI shows progress.

## Routes

| Page | Purpose |
|---|---|
| `/` | Explainer + role cards |
| `/employer` | Register employee (private salary), anchor batch |
| `/employee` | Claim via opening; lists demo openings |
| `/auditor` | Public ledger: headcount, batches, commitments |

| API | Purpose |
|---|---|
| `GET /api/status` | Network, contract, wallet readiness |
| `GET /api/ledger` | Public ledger (no wallet needed) |
| `GET /api/openings` | Demo openings joined with on-chain flags |
| `POST /api/employees` | `{salary}` → register, returns id + commitment + tx |
| `POST /api/claim` | `{id, salary, nonceHex}` → claim |
| `POST /api/batch` | `{tag}` → anchor batch |

## Notes

- Writes serialize through a server-side mutex (one wallet, one tx at a time).
- Openings are stored in the root `.payroll-allocations.<network>.json`, shared
  with the CLI — demo key-management only. Production must deliver openings
  employer → employee encrypted and off-chain.
- Auditor pages prove the point: amounts are unrecoverable from chain state.
