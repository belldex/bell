# Automatic On-Chain Wallet Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover candidate wallets automatically on supported Solana and Robinhood venues, reconstruct closed-position net PnL from on-chain facts, and qualify candidates without manual wallet input or vendor-reported profit.

**Architecture:** Consume normalized, venue-validated swap facts with explicit history coverage. Maintain an append-only per-wallet/per-token WAC ledger, mark unknown basis as incomplete, and derive rolling candidate metrics from time-ordered facts. Analytics APIs may be retained as diagnostic comparisons only.

**Tech Stack:** Node.js 22.23+, TypeScript strict, Zod, Node test runner, existing `JsonFileStore`, fixture/replay files; no signer, broadcaster, or production secret.

## Global Constraints

- No manual source-wallet allowlist is required or used for live eligibility.
- Only fully closed, complete, supported-venue positions contribute to realized PnL.
- PnL is net of attributable protocol fees, tips, network fees, and gas. Primary PnL remains in the on-chain quote asset; USD conversion uses only a validated historical on-chain oracle or block-pinned DEX quote, with source/version recorded.
- Unknown transfers, mint/burns, airdrops, missing backfill, unknown venues, and mismatched token-account basis set `coverage= incomplete` and block eligibility for the affected wallet/token history.
- Eligibility defaults: >=30 closed positions, >=10 distinct tokens, net realized PnL >0 on 30d and 90d, max drawdown <=50%, max one token <=50% of positive realized token PnL, complete supported-venue coverage.
- Drawdown uses the reconstructed equity curve including open holdings marked from on-chain prices; unrealized PnL never contributes to profit qualification. Max-token concentration is the token's positive realized PnL divided by total positive token-level realized PnL.
- Per-chain seed/cap is $20; only $20 cumulative net realized profit increments the cap by another $20. External deposits and unrealized gains never increase the cap.
- Keep max(15% current equity, estimated on-chain fee-to-close reserve) unspent; max entry 25% of spendable equity; maximum three open positions per chain.
- Unverified/unrealized/provider-reported values never count toward realized performance or cap compounding. Third-party analytics are post-score discrepancy checks only; they do not supply candidates or prioritize backfills.
- Deterministic offline tests only; no RPC keys, vendor keys, private keys, or network requests in test code.

## File Map

- Modify `src/domain/events.ts` — normalized fact fields.
- Create `src/domain/onchain-fact.ts` — validation and stable fact id.
- Create `src/wallets/ledger.ts` — WAC cost basis, partial exits, fee attribution, history completeness.
- Create `src/wallets/score.ts` — rolling score, reason codes, promotion rules.
- Modify `src/wallets/manager.ts` and `src/wallets/evidence.ts` — preserve old records and distinguish candidate/provenance states.
- Create `src/wallets/backfill.ts` — cursor/range completeness contracts, dedupe and reorg handling.
- Create root-level tests `test/onchain-fact.test.ts`, `test/wallet-ledger.test.ts`, `test/wallet-score.test.ts`, and `test/wallet-backfill.test.ts`, plus fixtures under `test/fixtures/onchain/`. Keep tests at the root because the current cross-platform `npm test` script runs `test/*.test.ts`.

## Tasks

### Task 1: Validate normalized swap facts

**Interfaces:** `parseOnchainSwapFact(input: unknown): OnchainSwapFact` throws a reason-coded `InvalidOnchainFactError`; `factId(fact): string` returns `${chain}:${txId}:${eventIndex}`.

```typescript
type ChainId = "solana" | "robinhood";
type VenueId = "pump_curve_v3" | "pump_swap_v2" | "uniswap_v2" | "uniswap_v3";
type TradeSide = "buy" | "sell";
type FactCoverage = "complete" | "partial" | "unknown";

interface OnchainFeeFact {
  kind: "network" | "protocol" | "lp" | "creator" | "priority" | "tip";
  payer: string;
  asset: string;
  rawAmount: string;
}

interface OnchainSwapFact {
  chain: ChainId;
  txId: string;
  eventIndex: number;
  blockOrSlot: string;
  timestampMs: number;
  wallet: string;
  venue: VenueId;
  tokenAddress: string;
  quoteAsset: string;
  side: TradeSide;
  tokenAmountRaw: string;
  tokenDecimals: number;
  quoteAmountRaw: string;
  quoteDecimals: number;
  fees: OnchainFeeFact[];
  successful: true;
  confirmation: "confirmed" | "soft_confirmed" | "finalized";
  decoderVersion: string;
  coverage: FactCoverage;
}
```

`rawAmount` and token quantities remain decimal integer strings at the parser boundary; the ledger converts to `bigint`. USD values are stored as integer micro-dollars (`bigint`) with the oracle/quote source and timestamp alongside the value.

- [ ] Write fixtures for Solana signature/slot and EVM hash/block identity, multiple instructions/logs, unknown fee, explicit fee, failed tx, stale/soft/finalized status, and absent venue metadata.
- [ ] Run `npx tsx --test test/onchain-fact.test.ts`; expected failures are missing exported parser/type.
- [ ] Implement schema validation, raw-integer amount constraints, timestamps, provenance, and `coverage` enum `complete | partial | unknown`.
- [ ] Add tests proving duplicate facts have identical ids and malformed amounts/negative fees are rejected.
- [ ] Run targeted test and `npm run typecheck`; commit `feat: validate normalized onchain facts`.

### Task 2: Build the WAC position ledger

**Interfaces:** `WalletPnlLedger.apply(fact): LedgerUpdate`; `WalletPnlLedger.snapshot(wallet, token, at): PositionSnapshot`. `PositionSnapshot` exposes `remainingRaw`, `costBasisQuoteRaw`, `realizedNetPnlQuoteRaw`, `unrealizedQuoteRaw|null`, `closedQuantityRaw`, and completeness reasons. USD normalization is separate and optional.

```typescript
interface WalletPnlLedger {
  apply(fact: OnchainSwapFact): LedgerUpdate;
  snapshot(wallet: string, token: string, atMs: number): PositionSnapshot;
}

interface PositionSnapshot {
  wallet: string;
  token: string;
  remainingRaw: bigint;
  costBasisQuoteRaw: bigint;
  realizedNetPnlQuoteRaw: bigint;
  unrealizedQuoteRaw: bigint | null;
  closedQuantityRaw: bigint;
  complete: boolean;
  incompleteReasons: string[];
}

interface LedgerUpdate {
  applied: boolean;
  factId: string;
  position: PositionSnapshot;
}

// WAC basis released on a partial exit; all token units stay integer raw units.
const basisReleased = totalCostBasisQuoteRaw * soldTokenRaw / remainingTokenRaw;
const realizedNetQuote = grossQuoteOutRaw - exitFeesQuoteRaw - basisReleased;
```

- [ ] In `test/wallet-ledger.test.ts`, write tests for buy, partial sell, multiple buys, full close, repeat close, fee allocation, token decimals, and exact raw-integer arithmetic.
- [ ] Write tests for airdrop/mint/unknown incoming transfer and for a token sent to a different wallet; assert basis becomes incomplete and no profit is invented.
- [ ] Run `npx tsx --test test/wallet-ledger.test.ts` and confirm red failures for absent ledger.
- [ ] Implement deterministic WAC: total remaining cost basis divided by remaining quantity; allocate basis and entry fees proportionally to sold quantity; subtract exit fees from proceeds; value native fees at recorded transaction-time price.
- [ ] Deduplicate by fact id before mutating state; repeated application must be a no-op.
- [ ] Add overflow, zero-quantity, token-decimal mismatch, and negative-delta rejection tests.
- [ ] Run `npx tsx --test test/wallet-ledger.test.ts` and `npm run typecheck`; commit `feat: reconstruct wallet realized pnl from swaps`.

### Task 3: Preserve complete history and backfill coverage

**Interfaces:** `OnchainRangeSource.fetchRange(cursor, limit): Promise<{ facts: OnchainSwapFact[]; nextCursor: string; complete: boolean }>`; `WalletHistoryBackfiller.reconcile(wallet, checkpoint): Promise<CoverageResult>`.

```typescript
interface CoverageResult {
  status: "complete" | "gap" | "provider_limited" | "decoder_unknown";
  fromCursor: string;
  throughCursor: string;
  missingRanges: Array<{ from: string; to: string }>;
}
```

- [ ] In `test/wallet-backfill.test.ts`, test page overlap, duplicate transactions, empty ranges, provider 429/retry-after, deleted history, late-finalized facts, and explicit gap markers.
- [ ] Test that cursor is committed only after all facts in a range have been parsed and durably applied.
- [ ] Implement per-chain cursor serialization and append-before-checkpoint persistence; unknown history gaps stay incomplete and block candidate eligibility.
- [ ] Preserve legacy harvested and provider stats as unverified provenance; migrate legacy candidate hit/token/time fields without losing them.
- [ ] Test promotion from a migrated candidate only after future distinct validated swap observations; creator/deployer candidates remain excluded from entry eligibility.
- [ ] Run `npx tsx --test test/wallet-backfill.test.ts test/wallet-manager.test.ts`; commit `feat: backfill wallet history with coverage status`.

### Task 4: Qualify wallets automatically

**Interfaces:** `scoreWallet(snapshot, policy): CandidateScore`; `evaluateEligibility(score, policy): {status: "observing"|"eligible"|"suspended"|"excluded"; reasons: string[]}`.

```typescript
interface EligibilityPolicy {
  minClosedPositions: 30;
  minDistinctTokens: 10;
  positiveWindowsDays: [30, 90];
  maxDrawdownBps: 5_000;
  maxPositivePnlConcentrationBps: 5_000;
  requireCompleteCoverage: true;
}

interface CandidateScore {
  wallet: string;
  realizedNetPnl30dQuote: bigint;
  realizedNetPnl90dQuote: bigint;
  closedPositions: number;
  distinctTokens: number;
  maxDrawdownBps: number | null;
  largestTokenPositivePnlShareBps: number | null;
  completeCoverage: boolean;
  reasonCodes: string[];
}
```

- [ ] In `test/wallet-score.test.ts`, test 30 closed positions/10 tokens boundary, positive 30d and 90d net PnL, 50% max drawdown, 50% top-token concentration, unsupported-venue gaps, insufficient history, and provider-only metrics.
- [ ] Write tests for high win rate but negative net PnL, high absolute profit from one moonshot, creator/deployer, bundled same-slot buys, wallet-to-wallet self-transfer loops, and rapid round trips.
- [ ] Run `npx tsx --test test/wallet-score.test.ts` to verify each condition fails before implementation.
- [ ] Implement fixed windows from fact timestamps, only using data available as-of evaluation time; report score component values and reason codes.
- [ ] Add hysteresis: suspend immediately on incomplete coverage or a risk stop; re-qualify only after the full policy is re-evaluated.
- [ ] Persist eligibility changes atomically with an audit event; never silently auto-delete candidates.
- [ ] Run `npx tsx --test test/wallet-score.test.ts` and `npm run typecheck`; commit `feat: auto-qualify wallets from realized onchain pnl`.

### Task 5: Validate copyability, not just source PnL

**Interfaces:** `replayCopyFollower(sourceFacts, policy, executionModel): CopyReplayResult` reports source PnL, follower realized PnL, fees, missed trades, delayed-entry price impact, and uncertainty.

```typescript
interface CopyReplayResult {
  sourceNetRealizedUsdMicros: bigint;
  followerNetRealizedUsdMicros: bigint;
  copiedSignals: number;
  missedSignals: number;
  failedOrUnknownFills: number;
  maxFollowerDrawdownBps: number;
  coverage: "complete" | "incomplete";
}
```

- [ ] In `test/copy-replay.test.ts`, write time-ordered tests with same-block bundle activity, one-slot delay, 10%/50%/100% partial exits, and a source who never sells losing positions.
- [ ] Write tests proving no future price/trade is visible at the signal time (no look-ahead bias).
- [ ] Include actual venue fee schedule version, quote freshness and execution latency in replay inputs.
- [ ] Require follower net PnL after costs >0 across held-out time windows before a candidate becomes `eligible`.
- [ ] Run `npx tsx --test test/copy-replay.test.ts`; document replay as a filter, not a profit guarantee; commit `feat: score wallet copyability with delayed replay`.

## Self-Review

- Candidate eligibility cannot be created by vendor leaderboard claims, airdrops, transfers, unrealized marks, or unsupported DEX history.
- The WAC method and historical fee-price source are named explicitly; tests cover partial quantities and attribution gaps.
- History coverage and checkpoint semantics are implemented before scores can qualify wallets.
