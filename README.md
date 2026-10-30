# BELL

Session-aware AMM for Robinhood Chain stock tokens. Fees and flow limits adapt to market sessions
(regular, extended, overnight, planned closure); if the calendar, price source, or health state is
unclear, swaps halt rather than guessing.

## Start here

| Document | Contents |
|---|---|
| **`docs/CURRENT-STATE.md`** | Current state: what is live on-chain, what is not, and the evidence. **Read this first.** |
| `docs/BELL-Developer-Brief-Final.md` | Normative specification (hash-pinned; do not modify) |
| `docs/BELL-Implementation-Plan-Final.md` | 16-milestone / 80-task plan (hash-pinned; do not modify) |
| `evidence/task-status.json` | Ledger status per task |
| `evidence/release-index.json` | Index evidence rilis (E01–E06) |
| `docs/runbooks/` | Testnet deployment, Yahoo source, data rights, keeper, indexer, migrations, recovery |

If any document conflicts with `docs/CURRENT-STATE.md`, that document is out of date.

## Quick status

- **Robinhood Chain mainnet (4663) is deployed.** The protocol stack, Yahoo source verifier/adapters,
  reference adapters, stock assets, and 2026 calendars have live deployment evidence under
  `evidence/deploy/`. Mainnet has no pool or swap yet.
- **Testnet (46630) has completed rehearsal swaps and acceptance runs.** Those pools use rehearsal
  fixtures and are not evidence of mainnet liquidity or token data rights.
- Mainnet price paths use **Yahoo Finance + the BELL EIP-712 reporter** for session health, with
  **Chainlink AggregatorV3 references** available for independent price checks. Yahoo feed rights are
  not verified by deployment evidence (`rightsVerified: false`).
- **Swap enforcement is active for SESSION_ONLY.** `BellHook` prepares and settles swaps;
  policy evaluation was moved to `BellPolicyOracle` to fit within EIP-170.
- **PRICE_GUARDED has independent reference adapters deployed**, but pool creation still needs current
  session health and explicit seed amounts. The matrix planner shows which pairs are ready or blocked.
- The Cloudflare Worker is deployed in pull mode: public signed quote bundles and onchain pool discovery
  are live. It does not run a periodic transaction loop. `/pools` currently returns an empty directory
  because no pool has been created.
- The frontend reads live pool state and has the wallet approval and router swap flow. A live mainnet pool
  must be created and seeded before a mainnet swap can run.

## Structure

```text
contracts/          Solidity: hook, registry, factory, router, adapter, treasury, library
packages/domain/    State machine, budget, policy, indexing, keeper logic (runtime-neutral)
packages/protocol/  Codec, ABI, calendar, Yahoo attestations, testnet status
apps/web/           Next.js UI (read-only on testnet; does not submit transactions)
workers/keeper-b/   Cloudflare Durable Object keeper
supabase/           Migrations, RLS, edge functions
scripts/            discovery / deploy / evidence / calendar / tooling
evidence/           Deployment manifests, runtime evidence, task ledger, release index
docs/               Brief, plan, runbooks, reviews, CURRENT-STATE
```

## Commands

```bash
pnpm install
pnpm check                                  # all gates: tests, compile, ABI, evidence, secrets

pnpm test:contracts                         # forge test
pnpm test:unit                              # node:test
pnpm test:runtime                           # node portable + deno + keeper-b

pnpm compile:solidity
pnpm abi:check
pnpm evidence:check

node scripts/deploy/check-testnet-addresses.mjs --rpc      # state onchain vs manifest
node scripts/deploy/verify-testnet-deployment.mjs --check  # is deployment evidence still valid?
```

Commands that are still scaffolds and intentionally fail with `BLOCKED`: `test:e2e`, `test:fork`,
`test:invariants`, `preflight:sources`, `preflight:rpc`, `release:dry-run`. These fail honestly;
this is intentional, not a bug.

## Warnings

- `.env` is never committed. `YAHOO_REPORTER_PRIVATE_KEY` must be separate from
  governance/treasury.
- The EIP-712 reporter is a trust boundary: Yahoo does not sign its responses.
- `AaplTestnetFacade` is not a Robinhood stock token. It is a fixture that lets the adapter constructor pass its code check on testnet.
- The SafetyController treasury is still a burn address; handover has not been rehearsed.
