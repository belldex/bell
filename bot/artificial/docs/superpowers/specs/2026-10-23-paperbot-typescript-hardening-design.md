# Dual-Chain Paper Bot Hardening and Live-Ready Design

Date: 2026-10-23
Status: Superseded by `2026-10-23-auto-discovery-live-copy-trading-design.md`; do not implement this paper-first design.

## Goal

Harden the existing Solana/Pump.fun and Robinhood Chain paper-trading service, migrate its source to TypeScript, improve data provenance and simulation fidelity, and implement chain-specific live execution adapters behind a fail-closed lock. The deployed default remains paper-only; no live transaction may be signed or broadcast during this work.

## Context

The current service runs on the user's Ubuntu VPS under PM2 and consumes real feeds (Solana mainnet RPC/WebSocket, PumpPortal, Robinhood Chain RPC, DexScreener, and Binance price quotes), while its balances/fills are virtual. The project is not a Git repository. Existing paper state and wallet data must be preserved and migrated safely. The operator has explicitly allowed stopping/restarting the paper service during implementation.

## Decisions

### Runtime and source language

- Keep Node.js as the runtime and migrate application source to strict TypeScript, compiled to `dist/` for PM2.
- Use the existing project as the behavioral reference; do not rewrite the project in Rust.
- Keep both Solana and Robinhood paper engines in scope.

### Execution modes and live lock

- `paper` is the default and only mode used in tests and the VPS service during this implementation.
- Implement `PaperExecutor` and chain-specific `LiveExecutor` adapters behind one typed execution interface.
- Live execution requires all of: `TRADING_MODE=live`, `ALLOW_LIVE_TRADING=true`, explicit complete risk limits, explicit chain/router configuration, and an injected signer. The runtime must fail closed if any requirement is absent or invalid.
- No private key is collected in chat, copied into the workspace, logged, written into JSON state, or used in this project turn. No test may broadcast a transaction or contact a live signing key. Live adapters are tested with fake signers/senders only.
- The final VPS configuration remains paper mode, even though live adapters are implemented.

### Data and strategy correctness

- Keep provider-reported wallet statistics distinguishable from independently verified on-chain evidence.
- Harvested/dev/early-buyer observations remain unverified scouts with bounded sizing; they are not assigned fake PnL/win-rate values. Deployer activity is a risk signal and must not itself cause an entry.
- Decode target buys/sells only after resolving the transaction signer, mint, venue, quote amount, and relevant token balance deltas. Aggregate all token accounts for a wallet/mint and deduplicate by transaction signature/instruction identity.
- Support Pump bonding-curve and PumpSwap events separately. Do not claim PumpSwap coverage if the selected data provider cannot supply its events.
- Route a price update only to its matching curve/pool subscription. Stale/default prices are marked unknown and cannot trigger entries or be presented as live marks.
- Simulation fills account for venue-specific fees, a configurable latency/slippage/impact model, network/tip costs, and failed/unavailable exits. Paper PnL is labeled as a model estimate, not realized on-chain PnL.
- Mirror target partial sells as a fraction of the bot's remaining position; strategy TP scale-outs use their own explicitly defined fraction basis. Protective exits may sell earlier.

### Persistence, safety, and operator controls

- Keep JSON storage for this iteration, but serialize writes per file, write through a temporary file plus atomic rename, and record failed writes. Never silently replace an invalid position state with a fresh balance; quarantine/backup the corrupt file and enter safe mode until state is recoverable.
- Persist event/order idempotency keys and pending live-order intents before any live send. A send timeout is an unknown result, not a failed trade eligible for blind retry.
- Validate all config values and external payloads. Metadata URLs must be HTTPS and blocked from loopback, private, link-local, and redirect-to-private destinations. Unknown safety-provider results are explicit; they are not represented as a positive safety result.
- Telegram commands must validate ranges and labels, escape untrusted content, distinguish paper status from live mode, and accurately report all chain positions. `/sellall` closes paper positions on both engines; it never broadcasts while mode is paper.
- Keep secrets and state owner-only. Atomic writes use mode `0600`; data directories use owner-only permissions where practical.

## Components

1. **Typed config and validation** — strict schemas, explicit mode and risk limits, secret redaction.
2. **Provider adapters** — Solana/PumpPortal, Pump/PumpSwap, Robinhood RPC/DexScreener, price feeds, and RugCheck; all tested through injected fakes.
3. **Normalized events and wallet intelligence** — typed trades, source/coverage provenance, verified/unverified wallet tiers, no fabricated performance.
4. **Strategy and paper execution** — pure sizing/exit policy, venue quote model, bounded fills/fees, accurate partial exit accounting.
5. **Live execution adapters** — Pump/PumpSwap transaction builder and EVM DEX transaction adapter, both unavailable unless all explicit live gates pass; no live activation in this work.
6. **State repository and recovery** — atomic serialized writes, backups/quarantine, idempotency journal, safe startup reconciliation.
7. **Telegram and operations** — validated commands, truthful status labels, graceful stop/restart, logs without credentials.

## Validation

- Use Node's built-in test runner with deterministic fixtures and fake network/signing adapters; tests must not call Binance, RPC providers, RugCheck, DexScreener, PumpPortal, Telegram, or broadcast transactions.
- Type-check in strict mode and run syntax/build checks.
- Cover subscription routing, Pump/PumpSwap decoding and deduplication, target sell fractions, fee/slippage calculations, sizing floors, wallet provenance/tiering, URL SSRF protection, config gates, state recovery/concurrent saves, Telegram validation, and live-lock refusal.
- Run a paper-only shadow session using real read-only market feeds; no signer is instantiated and no transaction is sent.
- Back up VPS source/config/state before deployment; preserve current balances/positions and migrate harvested records as unverified. Keep the final PM2 process in paper mode.

## Explicit non-goals

- Do not enable live trading or fund a wallet during this work.
- Do not claim profitability, validated alpha, risk-free exits, or confirmed wallet identity.
- Do not remove the Robinhood paper engine or its historical state.
- Do not expose a public dashboard/API or add unrelated product features.

## Acceptance criteria

- The service builds from TypeScript and PM2 can run compiled `dist/` output.
- Existing JSON state is preserved or migrated without silent balance/position resets.
- External wallet statistics and unverified harvest observations are separately labeled and never assigned fabricated PnL.
- Every decoded swap has source provenance, slot/signature, venue, mint/quote, and confidence/status fields; unknown data cannot trigger an entry.
- Paper fills include configured cost assumptions and are visibly marked simulated.
- The live adapter code is present but refuses startup/send unless all gates pass; current VPS mode is paper and tests prove no signer/broadcast path is reachable in paper mode.
- Tests are offline and deterministic; all syntax/type checks pass.
