# Veiled Payroll — Private Payroll / Splits on Midnight Network

Pay people without publishing paychecks. Salaries enter the smart contract as
**private ZK inputs** — the public ledger carries only opaque commitment
hashes, claim flags, counters, and batch anchors. No salary amount ever appears
on-chain, yet anyone can verify headcount, claim status, and batch schedule,
and every claim is enforced by zero-knowledge proof.

- 💼 **Employer** — register staff with shielded salaries, anchor payroll batches
- 🧑 **Employee** — claim by proving a secret opening; wrong openings are rejected
- 🔍 **Auditor** — inspect the public ledger and confirm there's *nothing to see*

Two interfaces ship: a terminal CLI (`npm run cli`) and a Next.js web app
(`npm run frontend:dev` → http://localhost:3000).

---

## Table of contents

1. [How the privacy works](#how-the-privacy-works)
2. [ZK deep dive: commitments, witnesses, disclosure](#zk-deep-dive-commitments-witnesses-disclosure)
3. [Architecture](#architecture)
4. [Prerequisites](#prerequisites)
5. [Quick start](#quick-start)
6. [Using the app](#using-the-app)
7. [Contract reference](#contract-reference)
8. [Backend scripts reference](#backend-scripts-reference)
9. [Frontend API reference](#frontend-api-reference)
10. [Running a second wallet (true employee role)](#running-a-second-wallet-true-employee-role)
11. [Project structure](#project-structure)
12. [Networks & wallets](#networks--wallets)
13. [Environment variables](#environment-variables)
14. [State on disk](#state-on-disk)
15. [Troubleshooting](#troubleshooting)
16. [Trust model & limitations](#trust-model--limitations)
17. [Dependency notes](#dependency-notes)

---

## How the privacy works

The whole design fits in one idea: **the ledger stores hashes, people hold openings**.

```
Employer                              Ledger (public)                    Employee
   │                                        │                                │
   │ salary=5000, nonce=0x9f…               │                                │
   │ ──registerEmployee()──▶                │                                │
   │   ZK proof: "I am the owner,            │  commitments[0] = 0x63…da      │
   │   store commit(5000, 0x9f…)"            │  claimed[0] = false            │
   │                                        │                                │
   │   ══ salary + nonce travel off-chain ══╬══▶ (encrypted in production)   │
   │                                        │                                │
   │                                        │  ◀──claim(0, 5000, 0x9f…)────── │
   │                                        │    ZK proof: "I know an        │
   │                                        │    opening matching 0x63…da"   │
   │                                        │  claimed[0] = true             │
```

1. **Register** — the employer passes `salary` + a fresh random `nonce` as
   *private circuit arguments*. The circuit stores only
   `commitments[id] = persistentCommit(salary, nonce)` (a 32-byte hash) and
   `claimed[id] = false`. The salary is never written anywhere public.
2. **Claim** — the employee passes `(id, salary, nonce)`. The circuit
   recomputes the commitment and asserts it equals the stored one, asserts the
   slot is unclaimed, then flips the flag. A wrong salary (or a replayed claim)
   fails proof verification and the transaction is rejected.
3. **Batch** — the employer anchors a public tag like `"2026-09-payroll"` so
   auditors can verify schedule and headcount with zero amount data.

An auditor reading the chain sees: *3 employees, 2 claimed, latest batch
"2026-09-payroll", three opaque hashes.* Amounts are cryptographically
unrecoverable from that data.

## ZK deep dive: commitments, witnesses, disclosure

**Commitments (`persistentCommit`).** A commitment scheme has two properties:
*hiding* (the hash reveals nothing about the salary without the nonce) and
*binding* (you can't later find a different salary/nonce pair producing the
same hash). In-circuit it's computed with the protocol's SNARK-friendly hash
over the value and a 32-byte random nonce — cheap to prove, infeasible to
invert or brute-force (the nonce has 256 bits of entropy, so dictionary
attacks on plausible salaries fail). The `persistent` prefix means the output
is domain-separated for on-ledger storage: a commitment kept in ledger state
can't be confused with or linked to off-chain `transient` hashes.

**Witnesses (off-chain callbacks).** `witness ownerKey(): Bytes<32>` is
*declared* in Compact but *implemented* in TypeScript (`deploy.ts`, `cli.ts`,
`scripts/payroll-lib.ts`). During proof generation the prover calls out to
your machine, gets the secret, and feeds it into the circuit as a private
input. It lands in the proof's **private transcript** — proven about, never
published. The chain only ever sees the **public transcript**: ledger writes
and disclosed values.

**`disclose()` — the compiler-enforced gate.** Any value derived from private
data (witness outputs, circuit arguments) that crosses into public state must
be wrapped in `disclose()`, or compilation fails. Trace it in
`contracts/payroll.compact`:

- `commitments.insert(id, disclose(commitment))` — the hash *may* go public.
- `claim()` uses `disclose(id)` for map keys — looking up key `2` visibly
  touches slot 2, so the id is inherently public. (Honest tradeoff: observers
  learn *"employee #2 claimed"*, never *how much*. True unlinkability would
  need nullifiers instead of sequential ids.)
- `salary` and `nonce` are **never** disclosed — they flow only into
  `persistentCommit` (private computation) and `assert` comparisons. That's
  the entire privacy guarantee, checked by the compiler.

## Architecture

```
┌─ frontend/ (Next.js, :3000) ──────────┐  Human UI. Knows NO cryptography.
│ pages: Employer / Employee / Auditor   │
│  └─ API routes ──┐                     │
└──────────────────┼─────────────────────┘
                   │ spawns as child processes
┌─ scripts/ ───────▼─────────────────────┐  Plain Node (tsx). All chain I/O.
│ payroll-ledger/register/claim/batch/…  │
│ src/cli.ts, src/deploy.ts (same engine)│
└──────────────────┼─────────────────────┘
                   │ RPC / GraphQL / ZK proofs
┌─ devnet (Docker) ▼────────────────────┐  Local Midnight blockchain.
│ node:9944 · indexer:8089 · proof:6300 │
└───────────────────────────────────────┘
```

The load-bearing rule: **Midnight SDK code runs only as plain, unbundled Node
processes.** Next.js never imports it — API routes shell out to
`scripts/payroll-*.ts` and parse the JSON they print. (Bundling duplicates the
wasm-backed runtime classes and every transaction dies with
`expected instance of StateValue`; see [Dependency notes](#dependency-notes).)

## Prerequisites

- **Node 22+** (`node --version`)
- **Docker** with Compose v2 (for the local devnet)
- **Compact compiler 0.31.1** (`compact list`; the contract targets
  `language_version >= 0.23`)

> **On Windows:** npm scripts run natively, but the Compact compiler has no
> native Windows binary — run `npm run compile` (and `setup`, which calls it)
> inside WSL. See Midnight's
> [installation docs](https://docs.midnight.network/getting-started/installation).

## Quick start

```bash
npm install
cd frontend && npm install && cd ..
```

**1. Start the devnet** (first run pulls ~1.3 GB of images):

```bash
docker compose -f docker-compose.yml -f docker-compose.8089.yml up -d --wait
docker compose ps   # node, indexer, proof-server should all be "healthy"
```

> Why the extra `-f` file? Something on this machine already occupies host
> port 8088, so `docker-compose.8089.yml` remaps only the host-side indexer
> port to 8089 (container internals unchanged). On a clean machine, plain
> `docker compose up -d --wait` (port 8088) also works — but then skip the
> `MIDNIGHT_INDEXER_*` exports below.

**2. Compile the contract** (Compact → circuit JS + proving keys, ~1 min):

```bash
npm run compile
```

**3. Deploy** (wallet sync, DUST setup, deploy tx — several minutes of mostly waiting):

```bash
export MIDNIGHT_INDEXER_URL=http://127.0.0.1:8089/api/v4/graphql
export MIDNIGHT_INDEXER_WS_URL=ws://127.0.0.1:8089/api/v4/graphql/ws
npm run deploy
```

The contract address is saved to `.midnight-state.json`. Sanity-check it:

```bash
npm run test:e2e   # reconnects + asserts the public ledger shape
```

> `npm run setup` chains all three steps, but it calls plain `docker compose
> up` (port 8088) — on this machine, run the steps above manually instead.

## Using the app

### Option A — terminal CLI

```bash
npm run cli
```

Menu: **1** register employee (private salary + fresh nonce, opening saved
locally) · **2** claim (paste an opening; try a wrong salary to watch the
proof fail) · **3** anchor batch tag · **4** auditor view (commitments only) ·
**5** wallet balances · **6** exit.

### Option B — web app

```bash
npm run frontend:dev   # needs the two MIDNIGHT_INDEXER_* exports in its shell
```

Open http://localhost:3000 and run the demo loop:

1. **Employer** — register with salary `5000`. The result shows a *commitment
   hash*, never the salary.
2. **Employee** — your opening is listed (demo key-management). Claim it, then
   try the manual form with salary `9999` and watch the contract reject it.
3. **Auditor** — headcount, batch status, truncated hashes. Ask: *can I recover
   any salary from this screen?*

First write warms the wallet (sync, ~1 min); every transaction needs ~30–90 s
of ZK proving. The UI shows progress — don't double-submit. Writes serialize
through a server-side mutex: one demo wallet, one transaction at a time.

## Contract reference

**Ledger (all public):**

| Field | Type | Content |
|---|---|---|
| `owner` | `Bytes<32>` | employer id (owner secret itself stays off-chain) |
| `employeeCount` / `batchCount` | `Counter` | headcount / batch sequence |
| `commitments` | `Map<Uint<64>, Bytes<32>>` | id → salary-commitment hash |
| `claimed` | `Map<Uint<64>, Boolean>` | id → claimed flag |
| `batchTag` | `Opaque<"string">` | latest batch label |

**Circuits:**

| Circuit | Caller | Private inputs | Public effect |
|---|---|---|---|
| `registerEmployee(salary, nonce)` | owner only (witness check) | salary, nonce | stores commitment, `claimed[id]=false`, bumps headcount |
| `claim(id, salary, nonce)` | anyone holding the opening | salary, nonce | asserts opening matches + unclaimed, flips flag |
| `runBatch(tag)` | owner only | — | sets tag, bumps batch counter |

## Backend scripts reference

All print a single JSON object on stdout (`{ok:true,…}` or `{ok:false,error}`),
progress on stderr. Used by the CLI flows and spawned by the frontend API.

| Script | Args | Does |
|---|---|---|
| `payroll-ledger.ts` | — | public ledger, no wallet needed |
| `payroll-status.ts` | — | network, contract, wallet balance |
| `payroll-register.ts` | `<salary>` | owner-only register, saves opening |
| `payroll-claim.ts` | `<id> <salary> <nonceHex>` | ZK claim |
| `payroll-batch.ts` | `<tag>` | owner-only batch anchor |
| `payroll-openings.ts` | — | saved openings joined with on-chain flags |
| `e2e-check.ts` | — | reconnect + ledger-shape assertion (`npm run test:e2e`) |

Shared logic lives in `scripts/payroll-lib.ts` (wallet setup, providers,
witnesses, ledger decoding, allocation store).

## Frontend API reference

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | network, contract address, wallet readiness, balance |
| `GET /api/ledger` | public ledger view (no wallet sync) |
| `GET /api/openings` | demo openings + on-chain claimed flags |
| `POST /api/employees` `{salary}` | register → `{id, commitment, txId, blockHeight}` |
| `POST /api/claim` `{id, salary, nonceHex}` | claim → `{txId, blockHeight}` |
| `POST /api/batch` `{tag}` | anchor batch → `{txId, blockHeight}` |

Pages: `/` (explainer), `/employer`, `/employee`, `/auditor`. See
`frontend/README.md` for frontend internals.

## Running a second wallet (true employee role)

Today both roles share the deployer wallet (that's why openings sit in one
local file). The contract already supports separation — `claim()` is
permissionless: **whoever knows the opening can submit the claim from any
wallet**. To give the employee their own wallet:

1. **New shell, new identity.** On public networks each actor just uses their
   own phrase/seed:
   ```bash
   read -s MIDNIGHT_WALLET_MNEMONIC && export MIDNIGHT_WALLET_MNEMONIC
   npx tsx scripts/payroll-claim.ts 0 5000 <nonceHex>
   ```
   (`getOrCreateWallet` in `src/network.ts` picks up the env identity; the
   owner witness is only needed for owner circuits, so claims work fine.)
2. **Fund it.** Any wallet that *submits* needs DUST for fees, which accrues
   from registered NIGHT UTXOs — so fund the employee wallet first (faucet on
   `preview`/`preprod`), then register its UTXOs for DUST exactly like
   `src/deploy.ts` does for the deployer.
3. **Local devnet caveat.** On `undeployed`, `getOrCreateWallet` intentionally
   returns the pre-funded genesis seed and ignores env overrides (only that
   seed holds NIGHT). For local multi-wallet demos you'd patch it to honor
   `MIDNIGHT_WALLET_SEED`, transfer NIGHT from genesis to the new wallet, and
   run the same DUST-registration step for it.
4. **Going further.** To bind a salary slot to *a specific employee* (so a
   leaked opening can't be claimed by anyone), extend the opening with the
   employee's coin public key and assert it in `claim()` — i.e. commit to
   `(salary, nonce, recipient)` instead of `(salary, nonce)`.

## Project structure

```
payroll/
├── contracts/
│   └── payroll.compact        # the contract (private salary commitments)
├── contracts/managed/         # compiled output (gitignored build artifact)
├── src/
│   ├── network.ts             # networks, seeds/mnemonics, deployments, env overrides
│   ├── wallet.ts              # wallet facade + sync-state cache (+ wallet-state.ts)
│   ├── setup.ts               # `npm run setup` orchestrator
│   ├── deploy.ts              # DUST setup + deploy
│   ├── cli.ts                 # terminal UI (register/claim/batch/audit)
│   └── check-balance.ts       # NIGHT / DUST balances
├── scripts/
│   ├── payroll-lib.ts         # shared backend (providers, witnesses, ledger decode)
│   ├── payroll-{ledger,status,register,claim,batch,openings}.ts
│   ├── e2e-check.ts           # `npm run test:e2e`
│   └── clean.mjs              # `npm run clean`
├── frontend/                  # Next.js demo app (Employer/Employee/Auditor)
│   ├── app/*/page.tsx         # pages (client components, fetch JSON only)
│   ├── app/api/*/route.ts     # API routes (spawn scripts, never import SDK)
│   └── lib/payroll-server.ts  # spawn + mutex + JSON parsing
├── docker-compose.yml         # node + indexer + proof-server
├── docker-compose.8089.yml    # host-port workaround (this machine)
└── package.json
```

## Networks & wallets

| Network | When | Default? |
|---|---|---|
| `undeployed` | local devnet, genesis seed pre-funded, no faucet | ✅ yes |
| `preview` | public testnet, faucet: `https://midnight-tmnight-preview.nethermind.dev` | |
| `preprod` | public testnet, faucet: `https://midnight-tmnight-preprod.nethermind.dev` | |

The active network is **sticky** (`npm run network preview` to switch;
`--network <name>` flags also switch). Public nets generate a 24-word BIP-39
phrase on first use (Lace-compatible both directions — import/export via
`MIDNIGHT_WALLET_MNEMONIC`), persist it in `.midnight-state.json`, and poll
the faucet up to 10 min (`MIDNIGHT_FAUCET_TIMEOUT_MS` to extend).

> ⚠️ **LOCAL DEVNET ONLY.** The genesis seed (`0000…0001`) is public
> knowledge — never use it with real value.

Wallet sync state is cached in `.midnight-wallet-state/` (gitignored); a
corrupt cache falls back to fresh sync automatically.

## Environment variables

| Variable | Effect |
|---|---|
| `MIDNIGHT_WALLET_SEED` | hex seed override (ignored on `undeployed`, which pins genesis) |
| `MIDNIGHT_WALLET_MNEMONIC` | recovery-phrase override (e.g. your Lace phrase) |
| `MIDNIGHT_INDEXER_URL` / `MIDNIGHT_INDEXER_WS_URL` | indexer override (**required on this machine**: `…/8089/…`) |
| `MIDNIGHT_NODE_URL` | node RPC override |
| `MIDNIGHT_PROOF_SERVER_URL` | remote proof server (default: local `:6300`, keeps witness data on your box) |
| `MIDNIGHT_FAUCET_URL` / `MIDNIGHT_FAUCET_TIMEOUT_MS` | faucet behavior on public nets |
| `PRIVATE_STATE_PASSWORD` | private-state encryption (≥16 chars; default is a local-devnet placeholder) |

## State on disk

| Path | Content | Committed? |
|---|---|---|
| `.midnight-state.json` | seeds, mnemonics, deploy addresses | ❌ secrets |
| `.midnight-wallet-state/` | sync cache | ❌ cache |
| `.payroll-allocations.*.json` | salary openings, cleartext | ❌ demo key-management |
| `midnight-level-db/` (+ `frontend/`) | private-state stores | ❌ sensitive |
| `contracts/managed/`, `frontend/.next/` | build output | ❌ |

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `address already in use` on `compose up` | port 8088 squatted → use `-f docker-compose.8089.yml` + indexer env overrides |
| `Cannot connect to the Docker daemon` | wrong docker context → `docker context use default` |
| `expected instance of StateValue` | duplicate wasm runtime — ensure the `overrides` pin is installed; never import SDK code into Next.js bundles |
| `Contract not compiled!` | run `npm run compile` (needs Compact 0.31.1) |
| `No deploy on file` | run `npm run deploy` for the active network |
| `Not enough Dust` / `Insufficient Funds` on deploy | fresh devnet still generating DUST — deploy retries automatically (~100 s budget); check `npm run check-balance` |
| API `500` on writes | read the `error` field — contract rejections (wrong opening, double claim, non-owner) surface here |
| Wallet sync takes minutes | normal on first run / public nets; RPC disconnect logs during sync are harmless |
| `No DUST generated after 5 minutes` | node not producing blocks (`docker compose ps`, `logs node`) or wallet unfunded |

Stopping: `Ctrl+C` the frontend; `docker compose down` pauses the devnet
(keeps chain data), `down -v` wipes it. `npm run clean` removes compiled
output, state file, and wallet cache.

## Trust model & limitations

- The demo proves **payroll obligations**, not settlement: no real value moves.
  Settlement rails, tax, and FX are out of scope.
- Auditor guarantees cover **headcount, claim status, schedule** — amounts are
  taken on faith or via off-chain selective disclosure.
- Employee ids are sequential and claim activity per id is public (observer
  learns *who claimed*, never *how much*). Unlinkability would need nullifiers.
- Single demo wallet, cleartext local openings, no access control on the API —
  all acceptable for a local demo, none acceptable in production.

## Dependency notes

- `package.json → overrides` pins a single `@midnight-ntwrk/onchain-runtime-v3`
  (3.1.1). Without it, `compact-runtime` and `midnight-js-protocol` load two
  wasm builds and every write fails class-identity checks.
- Chain versions: node `1.0.0`, indexer-standalone `4.3.3`, proof-server
  `8.1.0`, Midnight.js `4.1.1`, `compact-runtime` `0.16.0`.
