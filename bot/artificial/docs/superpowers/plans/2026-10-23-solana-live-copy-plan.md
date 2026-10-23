# Solana Automatic Live Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a validated Solana/Pump live-copy pipeline that discovers target swaps on-chain, quotes supported Pump venues, and can submit orders only through the shared risk gate and isolated signer.

**Architecture:** Use a production streaming provider for transactions and an archival RPC for replay/backfill. Decode Pump curve v3 and PumpSwap v2 from instructions/events plus transaction balances; reject mismatches. Construct unsigned transactions from current official SDK/IDL state, simulate and bound all costs, then hand typed intents to the shared signer/sender/order journal.

**Tech Stack:** Node.js 22.23+, TypeScript strict, Solana RPC JSON, Yellowstone-compatible stream/provider SDK, official `@pump-fun/pump-sdk` only after security/version audit, `@solana/web3.js` compatible with decoded transaction versions, fake signer/sender in tests.

## Global Constraints

- No source wallet is typed manually; signal wallets come from the automatic on-chain eligibility service.
- Support only Pump bonding-curve v3 and PumpSwap v2 in the first live release; unknown program, version, quote mint, or event layout blocks an order.
- Pump event data must be cross-checked against top-level/inner instructions and aggregate token/quote balance deltas. The open official event-layout issue is a release blocker unless the chosen decoder is empirically validated.
- Target signal must be Solana `confirmed`; follower transaction is not treated as successful until status and transaction outcome are reconciled.
- Initial live capital is capped at $20 equivalent; no external key/funding is added by this plan.
- Only net realized profits increment the cap by $20 per $20 earned. Preserve max(15% equity, fee-to-close reserve); max entry 25% of spendable equity; maximum three positions.
- Automatic wallet criteria are 30 closed positions, 10 distinct tokens, positive realized net PnL on both 30d/90d, drawdown <=50%, <=50% concentration in one token, and complete on-chain venue history.
- Daily stop and session drawdown defaults are proposed at 50% of cap/high-water equity and must be approved before live activation.
- Tests are offline and cannot sign with a real key or send a real transaction.
- Production dependency graph must have no unreviewed critical/high advisories before a signer is enabled.

## File Map

- Create `src/solana/provider.ts` — provider interface and read-only RPC methods.
- Modify `src/solana/monitor.ts` — subscribe/reconnect/replay, rate limits, gap gating.
- Replace/extend `src/solana/trade-parser.ts` and `src/solana/pump-sdk-decoder.ts` — versioned transaction/event normalization.
- Create `src/solana/quote.ts` — curve/pool quote, fee config, real reserve and min-output validation.
- Create `src/execution/solana-builder.ts` — unsigned transaction construction only.
- Create `src/execution/solana-sender.ts` — typed send/confirmation adapter behind shared gate.
- Test root-level `test/solana-provider.test.ts`, `test/solana-decoder.test.ts`, `test/solana-quote.test.ts`, and `test/solana-live-execution.test.ts`; fixtures under `test/fixtures/solana/`. Root-level test files are required by the current `npm test` script.

## Tasks

### Task 1: Production stream/RPC contract and gap recovery

**Interfaces:** `SolanaReadProvider.getTransaction(signature, commitment)`; `getSignaturesForAddress(address, {before, until, limit})`; `SolanaTransactionStream.subscribe(accounts): AsyncIterable<SolanaNotification>`; each has bounded timeout and retry-after handling.

```typescript
interface SolanaReadProvider {
  getTransaction(signature: string, commitment: "confirmed" | "finalized"): Promise<RawSolanaTransaction | null>;
  getSignaturesForAddress(address: string, query: { before?: string; until?: string; limit: number }): Promise<SolanaSignatureInfo[]>;
}

interface SolanaNotification {
  signature: string;
  slot: number;
  error: unknown | null;
  logs: readonly string[];
}
```

Use `getTransaction` with `{ encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 1 }`; initial baseline lookups use `limit: 1`, historical reconciliation uses paged ranges and honors `Retry-After`.

- [ ] Test 429 with numeric/date `Retry-After`, reconnect, duplicate notifications, transaction-not-found, unavailable block time, and version 0/1 payload shapes.
- [ ] Test that one wallet’s cursor advances only after transaction fetch, decode, and ledger persistence all succeed.
- [ ] Implement a provider budget of at most one history-baseline request per second by default; allow a measured provider-specific override from validated config, not unlimited concurrency.
- [ ] Add backfill gap states and ensure new entry signals remain blocked until all subscribed wallet baselines reconcile.
- [ ] Run stream/RPC fixture tests; commit `feat: harden Solana stream and replay`.

### Task 2: Decode target trades for supported Pump venues

**Interfaces:** `DecodedTradeFact` is the shared `OnchainSwapFact` type from the wallet-intelligence plan. `decodePumpTransaction(tx: RawSolanaTransaction): DecodedTradeFact[]`; each fact includes venue, actual trader, mint, quote mint, raw amounts, fee data, signature, slot, instruction/event index, and confidence/completeness.

```typescript
type PumpVenue = "pump_curve_v3" | "pump_swap_v2";
function decodePumpTransaction(tx: RawSolanaTransaction): DecodedTradeFact[];
function assertPumpEventMatchesBalances(fact: DecodedTradeFact, tx: RawSolanaTransaction): "complete" | "unknown";
```

- [ ] Create fixtures for Pump `buy_v3`, `buy_exact_quote_in_v3`, `sell_v3`; PumpSwap `buy_v2`, `buy_exact_quote_in_v2`, `sell_v2`; failed tx; inner instructions; versioned tx; fee payer != trader; address lookup tables; Token-2022; synthetic migration; and multiple token accounts.
- [ ] Verify discriminators/layouts against pinned official Pump IDLs and an independently captured finalized transaction fixture; record SDK/IDL hash in fixtures.
- [ ] Add adversarial fixtures for malformed/truncated event bytes, the open event-layout mismatch, self-transfer, airdrop, mint, sell-to-wallet, bundled multiple swaps, and unknown quote mint. Expected behavior: no live-signal fact unless instruction and balance changes agree.
- [ ] Run parser tests red before implementation; implement strict parser with unknown fields producing `coverage=unknown`, not default values.
- [ ] Implement aggregate balance deltas across all user token accounts, native SOL fee/tip attribution, and target sell fraction only when source balance basis is complete.
- [ ] Run parser suite and review against every fixture; commit `feat: decode Pump curve and PumpSwap swaps`.

### Task 3: Quote and preflight supported Pump orders

**Interfaces:** `SolanaQuoteProvider.quoteBuy(mint, quoteAmountRaw, slot): QuoteResult`; `quoteSell(mint, tokenAmountRaw, slot): QuoteResult`; quote contains pool/curve state slot, quote mint, min output, fee breakdown, impact, expiry, and decoder/fee version.

```typescript
interface QuoteResult {
  venue: PumpVenue;
  quoteMint: string;
  inputRaw: string;
  minOutputRaw: string;
  stateSlot: number;
  protocolFeeRaw: string;
  creatorFeeRaw: string;
  lpFeeRaw: string;
  priorityFeeLamports: string;
  impactBps: number;
  validUntilMs: number;
}
```

- [ ] Test exact quote unit conversions, token decimals, curve reserve edge cases, negative/changed virtual quote reserves, PumpSwap effective quote reserves, fee schedules, and stale slot rejection.
- [ ] Test fee recipient/required ATA validation; missing required accounts must fail before signing.
- [ ] Implement dynamic min-output/slippage from the fresh venue quote and the approved cap; do not use DexScreener last price as executable output.
- [ ] Construct unsigned instructions and call `simulateTransaction` with supported transaction version and preflight config. Parse simulation errors/CU usage; block on simulation failure or excessive fees.
- [ ] Run fixtures, typecheck, and build; commit `feat: quote and simulate Solana Pump orders`.

### Task 4: Solana live execution adapter

**Interfaces:** `SolanaOrderBuilder.build(intent): Promise<UnsignedVersionedTransaction>`; shared `SignerClient.sign({chain: "solana", unsignedPayloadBase64, policyProof, idempotencyKey}): Promise<Extract<SignedPayload, {chain: "solana"}>>`; `SolanaSender.send(tx): Promise<signature>`; `SolanaConfirmer.wait(signature): Promise<processed|confirmed|finalized|failed|unknown>`.

```typescript
interface SolanaCopyIntent {
  factId: string;
  wallet: string;
  mint: string;
  venue: PumpVenue;
  side: "buy" | "sell";
  inputRaw: string;
  minOutputRaw: string;
  maxSpendLamports: string;
  expiresAtMs: number;
}
```

- [ ] Test builder rejects wrong chain/mint/venue, unsupported IDL, missing min-out, stale blockhash, slippage above policy, reserve breach, and fee/tip above caps.
- [ ] Implement signer as a remote/isolated interface. The bot process must never read key bytes; tests use a fake signer.
- [ ] Implement send idempotency using the signature derived before send. On timeout query signature status/history before any replacement or retry.
- [ ] Test processed→confirmed→finalized transitions, failed transactions, blockhash expiry, dropped sends, duplicate callbacks, and unknown-send recovery.
- [ ] Ensure live gate refuses without all signed policy/config prerequisites and paper executor has no sender reference.
- [ ] Commit `feat: add gated Solana Pump execution adapter` only after full offline tests pass.

## Self-Review

- The venue universe is closed; unsupported custom pairs/multi-hop routes cannot silently use SOL pricing.
- Both official instruction versions and the event-layout discrepancy are explicit test fixtures/release gates.
- RPC throttling prevents an uncontrolled burst and unresolved 429/gaps fail closed.
