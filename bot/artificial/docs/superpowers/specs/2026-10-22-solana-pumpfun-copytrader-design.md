# Solana Pump.fun Automated Copy-Trading Bot — Design

Date: 2026-10-22
Status: Proposed; awaiting user review

## Goal

Design a continuously running Solana bot that discovers and evaluates Pump.fun-related wallets, automatically copies eligible trading activity, manages its own positions and exits, and runs on an Ubuntu VPS. Runtime trading decisions are automatic; there is no per-wallet or per-trade approval step. The operator can request a graceful stop. No profitability is promised.

## Scope

### In scope

- Solana mainnet, Pump.fun bonding curves, and PumpSwap after migration.
- Automatic wallet candidate discovery, behavioral classification, performance scoring, qualification, demotion, and exclusion.
- Near-real-time transaction monitoring and trade parsing, with historical backfill and reconciliation.
- Automated entry sizing, execution, position tracking, and exit management.
- Persistent state, restart recovery, operational health checks, logs, and graceful stop.
- Deployment design for the user's Ubuntu VPS, without accessing it during design.

### Out of scope

- Robinhood Chain or other chains/launchpads.
- Guaranteeing returns, trading on private/non-public information, or evading compliance controls.
- Token creation, wash trading, artificial volume, mixers, or obfuscating fund flows.
- A multi-user SaaS, public dashboard, or mobile app. A minimal local/operator status interface may be added only if needed for safe operations.

## Decisions and rationale

### Runtime architecture

Use one Rust service for ingestion, decoding, wallet analysis, strategy evaluation, execution, persistence, and operational control. Run it under `systemd` on Ubuntu. Use SQLite in WAL mode for the single-host event journal and bot state. Keep interfaces between components explicit so the stream provider, analytics provider, and transaction sender can be replaced independently.

This is preferred over a Node-only service for the latency-sensitive core and over a split microservice design because the latter adds deployment and failure modes without a current need for multiple hosts or users.

### Data sources

- Live Solana transaction stream: Yellowstone gRPC-compatible provider, configurable by endpoint and credentials.
- Historical wallet candidates and analytics: provider adapter, initially supporting a wallet performance API such as Solana Tracker PnL V2. Provider analytics are candidate evidence, not trusted execution signals; the bot verifies recent on-chain activity and its own position accounting.
- Chain reads and transaction status: configurable Solana RPC provider, separate from the streaming interface where practical.
- Pump.fun protocol instructions, accounts, fees, and migration behavior: current official Pump documentation/SDK; do not hard-code stale instruction account lists.

All providers are external dependencies and may have cost, quotas, latency, outages, or incomplete history. Their availability and terms must be checked before live deployment.

## Components and responsibilities

1. **Stream supervisor** — opens and monitors the live transaction stream, subscribes only to relevant program/account activity, reconnects with backoff, tracks lag/health, and initiates backfill after gaps.
2. **Transaction decoder** — resolves versioned transaction account keys (including address lookup tables), filters failed/non-trade activity, identifies the trader, mint, quote amount, token amount, venue, and buy/sell direction. Every event is keyed by signature and instruction index for idempotency.
3. **Historical indexer and wallet profiler** — imports historical activity and provider analytics, reconstructs positions where possible, tracks data coverage, and marks missing/ambiguous evidence as unknown rather than zero.
4. **Wallet classifier and scorer** — classifies trader, early-entry/sniper, whale, arbitrage-like, creator/developer, and unknown behavior. It ranks only wallets with sufficient evidence; it does not infer identity or insider status from an address.
5. **Candidate lifecycle manager** — automatically discovers, observes, qualifies, monitors, demotes, and excludes candidates. No user approval is needed during runtime. Candidate transitions and their evidence are recorded for audit.
6. **Signal/risk engine** — turns decoded target activity into an entry/exit proposal, checks token/venue state, available balance, exposure, slippage, fees, stale-price limits, and configured risk caps. It may skip a target trade.
7. **Pump execution adapter** — quotes and builds current Pump/PumpSwap transactions, applies configured slippage and priority/tip policy, signs locally through a signer interface, submits, tracks status, and reconciles actual token/SOL balances. No raw target transaction is replayed.
8. **Position and exit manager** — stores bot-specific cost basis, fills, fees, remaining quantity, peak value, and exit state. It processes target sells proportionally while applying independent protective exits.
9. **State store and audit log** — SQLite WAL tables for stream cursor/checkpoints, raw event references, decoded swaps, wallet scores, decisions, submitted transactions, fills, positions, and bot state. Never store seed phrases or unencrypted signing material in the database.
10. **Operations controller** — exposes status, health, logs, and graceful stop through a restricted local operator mechanism (initially a CLI/systemd signal; no public unauthenticated control endpoint). Optional notifications can be added without making them a trading dependency.

## Wallet discovery and qualification policy

### Candidate sources

Build a candidate pool from observed Pump.fun/PumpSwap traders plus the configured historical analytics provider. Reconcile provider observations against on-chain trades. The scorer records source, coverage window, last refresh, and evidence quality.

### Features

Score candidates using:

- Net realized PnL after identifiable protocol/creator fees, network fees, tips, and failed-transaction fees.
- Risk-adjusted return and drawdown, not raw ROI alone.
- Number of closed positions and distinct mints, recency, and coverage confidence.
- Consistency across time windows and tokens; penalize concentration in one exceptional winner.
- Entry/exit behavior and holding-time distribution.
- Trade size/liquidity fit and whether the wallet's entry is still plausibly copyable at the bot's observed latency.
- Data completeness and confidence; insufficient or contradictory data is ineligible.

Use a confidence-adjusted composite ranking with separate category tags. Initial production weights and evidence thresholds must be calibrated on historical/replayed data and kept versioned in config; do not treat a provider's leaderboard or an arbitrary win-rate threshold as proof of skill. The scorer must support minimum evidence gates and record the reason for every qualify/demote/exclude action.

### Category-specific policy

- **Consistent traders:** eligible for copy signals only after evidence gates.
- **Early-entry/sniper wallets:** eligible only when observed latency, liquidity, and expected copy price pass stricter checks; otherwise alert/log and skip.
- **Whales:** size-aware signals, with exposure and price-impact limits; a large buy is not an automatic buy recommendation.
- **Arbitrage-like wallets:** classify and normally exclude from directional copying because the strategy may depend on atomic multi-venue execution unavailable to this bot.
- **Creator/developer wallets:** monitor as token risk signals; do not treat their buys as alpha by default. Their sells can trigger an accelerated risk response for related positions.
- **Unknown/ambiguous wallets:** observe only until behavior and evidence are adequate.

Wallet clusters based on shared funding/withdrawal patterns are heuristic and must not be represented as confirmed common ownership.

## Trade decision and position policy

### Entry

For each eligible target buy, calculate a bot-owned order from its own configured sizing policy; never copy the target's raw transaction or amount blindly. Before submitting, require a fresh quote/state and check:

- Token is tradeable on a supported Pump venue and current curve/pool state is valid.
- Quote age, expected price impact, slippage, fees, priority fee/tip, and transaction size are within configured caps.
- Candidate is still qualified and the signal is not duplicated or stale.
- Per-trade, per-mint, aggregate exposure, concurrent-position, and daily loss limits are not exceeded.
- No unresolved prior order/position exists that could cause a duplicate entry.

If any check fails or required state is unknown, skip the trade and log the reason (fail closed).

### Exits

- A target partial sell requests the same fraction of the bot's remaining position, capped to the bot's available balance.
- A target full exit requests a full bot exit.
- Independent bot protections (stop-loss, trailing stop, time limit, token/creator risk, liquidity deterioration, and execution failure handling) may sell earlier. Target behavior never disables risk controls.
- Exit orders use fresh quotes and bounded slippage; retry policy is finite and idempotent. If selling is temporarily impossible, retain the position as open, alert/log, and continue recovery attempts while the service is active.
- Position PnL uses actual fills and costs; estimated mark-to-market is labeled separately.

### Risk configuration and live-mode gate

The runtime is fully automatic, but live trading must not start without an explicit, valid policy specifying maximum trade size, maximum exposure per mint, aggregate exposure, maximum concurrent positions, slippage/fee/tip caps, and loss circuit breakers. These are startup policy settings—not approvals for individual trades. Missing, invalid, or contradictory settings disable live execution. Do not silently infer trading limits from wallet balance.

The bot has a global circuit breaker for repeated transaction failures, stale/missing market data, stream gaps that cannot be reconciled, and configured loss thresholds. A circuit breaker blocks new entries but leaves position monitoring and exits active.

## Stop and restart semantics

- **Graceful STOP:** atomically disable new entries; continue stream processing and management of open positions; exit positions under the configured exit policy; when all positions are confirmed closed and all submitted transactions reconciled, stop the service.
- **Emergency stop:** a separate operator action blocks new entries immediately and attempts to close open positions using configured bounded execution rules, then exits. It must not claim success until chain state is reconciled.
- **Process crash/reboot:** `systemd` restarts the service. Before enabling entries, reconcile database orders/positions and wallet balances/on-chain signatures; recover unresolved submissions idempotently. If state cannot be reconciled, remain in safe mode (no new entries) and keep trying to manage known open positions.
- **Manual OS termination:** treat as an ungraceful crash; startup reconciliation applies. The documented STOP path is the graceful method.

## Event flow

`Yellowstone stream → signature deduplication → transaction decode → Pump trade event → wallet/position enrichment → candidate and token checks → risk decision → quote/build/sign/send → confirmation and fill reconciliation → position exit manager → audit/state store`

Historical data follows a separate backfill path into the same normalized event/position model. Live provisional events and confirmed/finalized events carry distinct statuses; reversals or mismatches are reconciled rather than silently overwritten.

## Security and deployment

- Target: the provided Ubuntu VPS, subject to a later compatibility/resource check. No VPS access or SSH login is authorized by this design approval alone.
- Run under a dedicated unprivileged Linux user, with `systemd` restart policy, restricted file permissions, firewall rules, log rotation, and OS security updates.
- Use a dedicated, low-balance trading wallet, separate from long-term holdings. Never send seed phrases/private keys in chat or commit them.
- Prefer a signer abstraction that can use a protected local key file with strict permissions or a KMS/HSM-compatible backend. The raw secret must not appear in logs, shell history, process arguments, crash reports, or database backups.
- RPC/gRPC/API credentials are secrets; use a root-readable service environment file or secret manager, rotate credentials, and redact them from diagnostics.
- Outbound dependencies are allowlisted where practical. No public control port is opened by default.

## Observability

Structured logs and metrics must cover stream connection/lag/reconnects, backfill gaps, parse failures, event-to-decision and decision-to-land latency, provider quota/errors, quote staleness, decision reasons, transaction send/confirm/fail rates, open exposure, realized/unrealized PnL, database health, and circuit-breaker state. Logs must avoid secrets and clearly distinguish observed facts, estimates, and model scores.

## Validation strategy

1. Unit tests for transaction parsing, versioned account resolution, deduplication, Pump venue/migration detection, wallet position accounting, scoring, sizing, and stop-state transitions.
2. Fixture/replay tests from captured public transactions, including failed transactions, partial sells, multiple instructions, fee/rent transfers, migration boundaries, and stream duplicates/gaps.
3. Property/invariant tests: no duplicate order per signal; never sell more than held; risk caps never exceeded; unknown state blocks entries; STOP never adds positions; repeated restart reconciliation does not duplicate an order.
4. Historical replay/backtest with conservative latency, fee, slippage, failed-fill, and data-gap assumptions. Prevent lookahead bias and report sample coverage, not only win rate.
5. Long-running paper/shadow mode against live streams without signing/broadcasting, verifying wallet discovery, decisions, persistence, reconnects, and graceful stop.
6. Live mode is a separate explicit deployment configuration, gated by complete risk policy and operator-provided wallet/provider configuration. Testing with the user's funded wallet happens only after code and validation are complete and after explicit deployment authorization; secrets are provided directly on the server, never in chat.

## Key failure modes and mitigations

- **Stream outage or missed events:** health alarms, reconnect/backoff, checkpointed backfill, safe mode until reconciled.
- **Wrong trade interpretation:** IDL/SDK-based parser, fixtures, current-program compatibility checks, fail-closed behavior.
- **False wallet performance:** independent on-chain reconciliation, evidence confidence, closed-position accounting, sample-size gates, continuous demotion.
- **Copy latency/price drift:** stale-signal and max-price-deviation filters; skip instead of chase.
- **Rug, creator dump, illiquidity:** token/creator risk checks, liquidity/impact limits, independent exit triggers; no filter guarantees safety.
- **Duplicate/reordered transactions:** signature/index idempotency, durable outbox/order state, reconciliation before retry.
- **RPC/provider quota or outage:** health circuit breaker, bounded retry/backoff, provider adapters; never bypass configured limits to force an order.
- **Key compromise:** dedicated wallet, least privilege, strict secret handling, low balance, signer abstraction, host hardening.

## Risks and limitations

Public chain data is transparent but incomplete as a record of strategy intent. Wallet labels and clustering are heuristic. Historical performance can be incomplete and does not predict future returns. Fees, tips, slippage, transaction ordering, liquidity, token behavior, provider outages, and protocol upgrades can turn apparent profits into losses. No “insider” inference is made from public wallet data. The system must report these limitations and must not claim guaranteed or risk-free trading.

## Acceptance criteria for the design

- The bot discovers and scores wallet candidates automatically and does not require per-wallet/per-trade approval at runtime.
- The bot only trades eligible Pump.fun/PumpSwap swaps, with logged reason codes for executed and skipped signals.
- Entries and exits are idempotent and use bot-owned risk sizing; target sells are proportional signals, not raw transaction replay.
- Positions and orders survive restart through reconciliation; an unresolved state blocks new entries.
- Graceful STOP stops new entries, manages open positions until reconciled flat, and then shuts down.
- Missing risk policy, stale state, or unreconciled stream gaps fail closed for entries.
- Secrets never enter chat, source control, logs, or the database.
- Testing differentiates simulation/paper from live signing/broadcasting, and deployment/live use requires separate explicit authorization.
