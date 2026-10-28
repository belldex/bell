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

- **End-to-end has run on Robinhood Testnet (46630).** The first pool is live and the first swap succeeded
  onchain: 5 token0 → 3 token1, budget commit `[5, 3]`, rolling cap turun `[100,100] → [95,97]`.
- The protocol implementation is complete and all suites are green: 351 forge tests (27 suites, including 2 suites
  invariant runs of 100k), 297 node:test, 45+18 reference Python, 15 Deno, 6 keeper-b.
- Price path: **Yahoo Finance + BELL EIP-712 reporter**. Chainlink is not used (paid).
- **Swap enforcement is active for SESSION_ONLY.** `BellHook` prepares and settles swaps;
  policy evaluation was moved to `BellPolicyOracle` to fit within EIP-170.
- **PRICE_GUARDED remains blocked** (no reference has been admitted yet).
- **Mainnet has not been touched.** No transactions have occurred on chainId 4663.
- The frontend does not submit transactions; the price keeper is still a no-op.

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
