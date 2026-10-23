# Shared Live Risk, Custody, and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide one fail-closed risk/signer/order framework shared by the Solana and Robinhood live-copy executors.

**Architecture:** Policy evaluation is pure and tested before any signer access. A durable order journal records intent before signing/submission. A remote/isolated signer accepts only typed, policy-approved intents; the bot process never reads or logs key bytes. Per-chain executor state is reconciled independently.

**Tech Stack:** Strict TypeScript, Zod, `JsonFileStore` initially, Node test runner, fake signer/sender in tests, deployment secret store or external signer/KMS in production.

## Global Constraints

- Current VPS app and build remain paper-only until all child plans pass and a separate live-release approval is given.
- Seed capital cap is $20 equivalent per chain. Cap formula: `$20 + $20 * floor(max(0, cumulative net realized trading PnL since start) / $20)`, further capped by current net equity and reserve.
- Deposits, transfers, unrealized gains, third-party PnL data, and incomplete ledger basis never increase compounding cap.
- Keep max(15% of equity, current fee-to-close reserve) unspent; max one entry 25% of spendable equity; max three open positions per chain.
- Proposed initial daily breaker (requires user approval before activation): stop entries at 50% of chain cap in realized daily loss or 50% drawdown from session equity high. Existing positions continue only under an explicitly tested exit policy.
- No private keys in chat, source, `.env`, PM2 ecosystem, tests, logs, order journal, or state JSON.
- Test signers/senders are fakes; tests never broadcast or use a funded key.

## File Map

- Extend `src/config/schema.ts` and `src/config/load.ts` — live risk policy, unit validation, paper/live mode, release gate.
- Create `src/execution/risk-policy.ts` — pure cap/reserve/entry validation.
- Extend `src/execution/live.ts` — typed executor interfaces and preflight gate.
- Extend `src/storage/order-journal.ts` — durable transitions, unknown-state reconciliation, chain/idempotency metadata.
- Create `src/execution/signer-client.ts` — authenticated isolated signer protocol; no raw key material in app process.
- Create `src/execution/circuit-breaker.ts` — health, daily loss, drawdown, stale quote, data-gap, and manual pause states.
- Create root-level `test/risk-policy.test.ts`, `test/signer-client.test.ts`, `test/order-journal-live.test.ts`, and `test/live-release-gate.test.ts`. Root-level test files are required by the current `npm test` script.
- Modify `deploy/ecosystem.config.cjs` and `docs/operations-live-readiness.md` only after all gates.

## Tasks

### Task 1: Implement exact risk calculations

**Interfaces:** `computeChainBudget(policy, accountState): {capitalCapUsd, currentEquityUsd, spendableUsd, reserveUsd}`; `validateLiveIntent(order, policy, chainState): Decision` with stable reason codes.

```typescript
interface LiveRiskPolicy {
  seedCapUsdCents: bigint;            // 2_000 cents
  realizedProfitStepUsdCents: bigint;  // 2_000 cents
  reserveBps: number;                 // 1_500
  maxEntryBps: number;                // 2_500 of current spendable balance
  maxOpenPositions: number;           // 3
  dailyLossStopBps: number;           // proposed default 5_000, user approval required
  sessionDrawdownStopBps: number;     // proposed default 5_000, user approval required
}

function capitalCapUsdCents(policy: LiveRiskPolicy, cumulativeNetRealizedUsdCents: bigint): bigint {
  const steps = cumulativeNetRealizedUsdCents > 0n
    ? cumulativeNetRealizedUsdCents / policy.realizedProfitStepUsdCents
    : 0n;
  return policy.seedCapUsdCents + steps * policy.realizedProfitStepUsdCents;
}
```

- [ ] Test start equity $20, realized PnL +$19/+20/+40, realized loss after cap growth, external deposit, open unrealized gain, fee reserve larger than 15%, and equity below reserve.
- [ ] Test 25% entry ceiling, 3-position limit, duplicate token, per-day realized stop at 50%, 50% peak drawdown stop, and stale/gap/429 health block.
- [ ] Run tests and confirm the thresholds fail before implementing the risk module.
- [ ] Implement decimal-safe USD/cents math; store source price and timestamp for native SOL/ETH conversion.
- [ ] Ensure policy validation is applied by both the strategy and signing gateway; tests must prove one cannot bypass the other.
- [ ] Run risk tests and commit `feat: enforce per-chain live risk envelopes`.

### Task 2: Isolate the signer

**Interfaces:** `SignerClient.sign(request: SignRequest): Promise<SignedPayload>` and `SignerClient.health(): Promise<SignerHealth>`. The Solana and Robinhood signer adapters implement this shared interface; chain-specific senders consume the matching discriminated signed payload.

```typescript
interface SignRequest {
  chain: "solana" | "robinhood";
  unsignedPayloadBase64: string;
  policyProof: { orderId: string; policyVersion: string; maxDebitUsdCents: string; expiresAtMs: number };
  idempotencyKey: string;
}

type SignedPayload =
  | { chain: "solana"; signedTransactionBase64: string; signerPublicKey: string }
  | { chain: "robinhood"; signedTransactionBase64: string; signerAddress: `0x${string}` };

interface SignerHealth {
  ready: boolean;
  signerId: string;
}

interface SignerClient {
  sign(request: SignRequest): Promise<SignedPayload>;
  health(): Promise<SignerHealth>;
}
```

- [ ] Test unauthorized client, malformed chain/intents, excessive spend, wrong signer address, expired intent, signing timeout, redacted error, and repeated idempotency key.
- [ ] Implement an authenticated local/remote signer boundary. Configure keys only in that isolated service’s private secret store; the trading bot sends an unsigned transaction and receives a signed result.
- [ ] Ensure process config/environment contains no `SOLANA_PRIVATE_KEY`, `ROBINHOOD_PRIVATE_KEY`, mnemonic, seed phrase, or raw secret field.
- [ ] Add a negative startup test proving paper mode never constructs a signer and live mode cannot start if signer policy/health is absent.
- [ ] Run signer tests with a fake implementation only; commit `feat: isolate chain signing behind policy client`.

### Task 3: Make order journal crash- and timeout-safe

**Interfaces:** order states `intent | built | signed | submitted | processed | soft_confirmed | confirmed | l1_posted | finalized | failed | unknown`; each record includes chain, signal fact id, wallet/token, quote version, policy version, tx hash/signature, and reason codes. Solana maps `processed/confirmed/finalized`; Robinhood maps sequencer `soft_confirmed`, L1 `l1_posted`, and `finalized`.

```typescript
interface OrderIntentRecord {
  idempotencyKey: string;
  chain: "solana" | "robinhood";
  sourceFactId: string;
  state: "intent" | "built" | "signed" | "submitted" | "processed" | "soft_confirmed" | "confirmed" | "l1_posted" | "finalized" | "failed" | "unknown";
  transactionId: string | null;
  updatedAtMs: number;
  reason: string | null;
}
```

- [ ] Test intent persisted before signing, duplicate source fact, crash after signing, unknown send timeout, RPC replacement, Solana blockhash expiry, EVM nonce pending, reverted receipt, and restart reconciliation.
- [ ] Extend `OrderJournal` with monotonic transition validation and refuse a second transaction while an equivalent intent is `signed`, `submitted`, or `unknown`.
- [ ] Implement chain-specific reconciliation that queries transaction status/hash/nonce before any retry.
- [ ] Test a final accepted/rejected transaction updates the portfolio exactly once and does not create paper/live double accounting.
- [ ] Run journal tests; commit `fix: reconcile live order state idempotently`.

### Task 4: Add circuit breaker, kill switch, and operations

**Interfaces:** `CircuitBreaker.evaluate(health, riskState): {entriesAllowed, reasons}`; `pause(reason)` and `resume(authorizedOperator)`.

- [ ] Test stale quotes, provider 429, feed disconnected, unresolved history gap, decoder mismatch, signer timeout, loss cap, drawdown cap, low liquidity, and process restart; all must block new entries.
- [ ] Test that exit transactions require a separately validated emergency policy and cannot be invoked through the buy path.
- [ ] Add Telegram `/pause` and live status showing chain-specific mode, feed health, cap/used/reserve, and recent order states; escape all untrusted fields.
- [ ] Add redacted audit logs and file permissions (owner-only runtime data; no secret-bearing URLs or calldata with signatures/private material).
- [ ] Run circuit tests; commit `feat: add live circuit breakers and operator controls`.

### Task 5: Release gate and canary checklist

- [ ] Run full offline tests, typecheck, build, production audit, and an SBOM/runtime dependency review. No critical/high live runtime advisory can remain without written security approval.
- [ ] Verify chain ID, program/router code, pool factory, oracle/quote source, RPC quota, signer identity, and rollback procedure from a clean release directory.
- [ ] Verify a read-only historical replay first; then unsigned transaction simulation; then testnet/fork fake-signer integration. Never use the live key for tests.
- [ ] Require operator approval for each chain separately; start with $20 cap, per-entry 25% spendable ceiling, reserve, and breaker settings from the design.
- [ ] Keep the build-level live lock engaged until all above checks are signed off; change it only in the approved live release commit, never through environment variable alone.
- [ ] Document rollback: stop live process, disable signer policy, preserve order journal, restore the prior paper PM2 release without modifying the original paper data.
- [ ] Commit `docs: add per-chain live readiness and rollback checklist`.

## Self-Review

- The live cap is based only on this bot’s net realized PnL, not the source wallet’s PnL or deposits.
- Every live order has durable intent, isolated signer, strict state transitions, and unknown-send reconciliation.
- User’s high-risk preference does not remove the nonzero fee reserve, hard caps, fail-closed signal checks, or separate per-chain activation gate.
