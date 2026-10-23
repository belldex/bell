# Automatic Live Copy Trading Master Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build automatic on-chain wallet discovery and verified live copy-trading for Solana and Robinhood Chain, with user-approved $20-per-chain initial caps and fail-closed execution controls.

**Architecture:** Keep one shared on-chain fact model, PnL ledger, automatic wallet scorer, and risk policy, with separate Solana/Pump and Robinhood/Uniswap ingestion and execution adapters. Do not enable a chain until its own fixtures, backfill coverage, signer isolation, and transaction-reconciliation gates pass.

**Tech Stack:** Node.js 22.23+, strict TypeScript, Zod, Node test runner, official Pump SDK/IDL only after dependency review, Solana RPC/Yellowstone-compatible stream, viem, Robinhood Chain RPC/WebSocket provider, JSON journal initially with atomic writes.

## Global Constraints

- No manual source-wallet allowlist; candidates are discovered automatically from supported on-chain venues.
- Wallet live-eligibility uses closed, realized, net PnL only; unrealized PnL is displayed separately.
- Initial capital cap is USD $20 per chain; increase by $20 only per additional $20 cumulative net realized trading PnL on that chain. External deposits never count as profit.
- Keep the greater of 15% of current equity or estimated fee-to-close reserve unspent; each entry is at most 25% of current spendable equity; maximum three open positions per chain.
- Initial wallet criteria: at least 30 closed positions over at least 10 distinct tokens, positive net realized PnL over both 30d and 90d, max drawdown <=50%, no single token contributes >50% of realized profits, and complete supported-venue accounting.
- Solana live signal trigger is `confirmed`; Robinhood trigger is a validated sequencer soft confirmation. Track later finality separately.
- Solana scope starts with Pump bonding-curve and PumpSwap only. Robinhood live scope starts with verified Uniswap v2/v3; v4 and other DEXs are deferred.
- Never use a private key from chat, source, repo, paper `.env`, or JSON state. Use a dedicated wallet per chain and an isolated signer/KMS interface.
- No tests may load a real key, request a signature from a real signer, broadcast a transaction, or use live funds.
- If any required decoder, quote, history range, RPC health, router/program identity, or order status is unknown, block new entries.
- Production dependencies must have no unreviewed critical/high advisories. Development-only SDK dependencies are not permission to load them at runtime.
- Keep the deployed `solana-smart-bot-paper-ts` release and its data as rollback until a separate live release is approved.

## Plan Files and Execution Order

1. `2026-10-23-onchain-wallet-intelligence-plan.md` — normalized swaps, backfill coverage, WAC ledger, wallet scoring, historical copyability replay. It creates no signer or live order.
2. `2026-10-23-solana-live-copy-plan.md` — Solana/Pump stream, decoder, quotes, transaction builder, sender/reconciliation.
3. `2026-10-23-robinhood-live-copy-plan.md` — Robinhood RPC/WS, Uniswap pool indexing, event parser, quote and execution adapter.
4. `2026-10-23-shared-live-risk-custody-plan.md` — capital caps, isolated signer, journal, circuit breakers, and release gate.

The wallet-intelligence plan precedes both chain plans. The shared risk/custody plan can be implemented in parallel with read-only ingestion, but live activation is last. Each child plan ends with an independently testable artifact and its own review/commit.

## Master Tasks

### Task 1: Freeze the common fact and ledger interface

**Files:** Modify `src/domain/events.ts`; create `src/domain/ledger.ts`; test `test/onchain-fact.test.ts`.

**Interfaces:** `OnchainSwapFact` carries chain, venue, tx id, block/slot, event index, trader, base/quote assets, raw amounts/decimals, fee facts, confirmation, decoder version, and completeness. `OnchainDataSource.getRange(cursor)` returns facts plus a completeness cursor or an explicit gap.

- [ ] Add type/schema tests for Solana and EVM identities, unknown fees, missing balance basis, duplicate fact ids, failed swaps, and soft/final statuses.
- [ ] Run `npx tsx --test test/onchain-fact.test.ts`; confirm new schema tests fail before implementation.
- [ ] Implement Zod validation and stable idempotency key `${chain}:${txId}:${eventIndex}`.
- [ ] Run the targeted test, `npm run typecheck`, and `npm test`; commit `feat: define normalized onchain swap facts`.

### Task 2: Complete the wallet-intelligence plan

**Plan:** `docs/superpowers/plans/2026-10-23-onchain-wallet-intelligence-plan.md`.

- [ ] Implement backfill and gap tracking before candidate scoring.
- [ ] Implement WAC realized PnL and fee attribution using only complete supported-venue facts.
- [ ] Implement automatic discovery and criteria from the design spec.
- [ ] Validate no look-ahead bias with timestamped replay and held-out periods.
- [ ] Review and commit the wallet-intelligence deliverable before live executor work.

### Task 3: Complete both read-only chain adapters

**Plans:** Solana and Robinhood child plans.

- [ ] Run Solana and Robinhood fixtures/replay tests with all signers/senders fake or absent.
- [ ] Verify source identity, quote, decimals, fees, slot/block cursor, replay after disconnect, and unknown-gap rejection.
- [ ] Verify exact contracts/programs and decoder versions against official docs and on-chain code before enabling their venue adapters.
- [ ] Review and commit each chain's read-only adapter separately.

### Task 4: Implement shared live controls and signer isolation

**Plan:** `docs/superpowers/plans/2026-10-23-shared-live-risk-custody-plan.md`.

- [ ] Enforce $20 seed cap, $20 realized-profit cap increments, reserve floor, per-entry ceiling, max positions, drawdown stop, and daily stop at both decision and signer boundaries.
- [ ] Persist each order intent before signing; unknown submit state is reconciled before any retry.
- [ ] Prove paper mode cannot construct or call signer/sender and live cannot bypass signer/risk/dependency checks.
- [ ] Review and commit shared risk/custody code separately.

### Task 5: Per-chain canary readiness review (not automatic activation)

**Files:** Create `docs/operations-live-readiness.md`; update `deploy/` only after approval.

- [ ] Run full offline fixture suite, strict typecheck, production build, `node --check dist/cli.js`, `npm audit`, and `npm audit --omit=dev`.
- [ ] Run each chain's read-only replay against a measured, documented provider tier and record latency, errors, and coverage gaps.
- [ ] Run unsigned/unsigned-transaction simulation, fake-signer, fake-sender, receipt reconciliation, restart, and rollback drills.
- [ ] Confirm the user’s dedicated wallet, custody mechanism, $20 per-chain cap, reserve, per-order cap, max positions, and kill switch without receiving a private key in chat.
- [ ] Require explicit approval to enable one chain's real signer. Keep the other chain disabled until its independent review passes.
- [ ] Do not auto-fund, import a user’s existing key, bridge assets, or broadcast a real transaction as part of this implementation plan.

## Master Self-Review

- Spec sections 1–3 map to the wallet-intelligence plan; Solana ingestion/execution maps to the Solana plan; Robinhood ingestion/execution maps to the Robinhood plan; caps, signer, order state, and kill switch map to the shared-risk plan.
- User-approved values are stated verbatim: $20 initial cap per chain, $20 cumulative net realized profit per cap increment, 15%/fee-to-close reserve, 25% of spendable equity per entry, three positions maximum, and confirmed/soft-confirm signal policy.
- This master plan prepares a live-capable system but does not itself unlock or activate live execution.
