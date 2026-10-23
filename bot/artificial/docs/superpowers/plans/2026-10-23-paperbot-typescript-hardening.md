# Dual-Chain Paper Bot TypeScript Hardening Implementation Plan

> **Superseded:** This paper-first plan is retained for history only. Use `2026-10-23-live-copy-master-rollout.md` and its four child plans instead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing dual-chain paper bot to TypeScript, repair data/scoring/state/strategy defects, and implement live adapters that remain fail-closed and disabled.

**Architecture:** Work from a sanitized local mirror of `/home/ubuntu/solana-smart-bot`; keep Node as runtime and compile strict TypeScript into `dist/`. Separate live feeds, decoded events, decision logic, paper execution, and live transaction adapters; test through offline fake providers and never activate live mode.

**Tech Stack:** Node.js 22, TypeScript strict mode, Node built-in test runner, `tsx` for local test execution, runtime schema validation, Solana Pump SDK adapter, EVM signer/router adapter, JSON state with serialized atomic writes, PM2.

## Global Constraints

- Keep both current paper engines: Solana/Pump.fun/PumpSwap and Robinhood Chain.
- `paper` is the default and remains the VPS runtime mode throughout this work.
- Live adapters may be implemented, but no real signer/key is loaded, no real transaction is signed/broadcast, and live mode stays disabled.
- Do not copy `.env` or private credentials into the local mirror, tests, logs, or Git.
- Preserve existing state; never silently reset an invalid state file or wallet data.
- All tests must be deterministic and offline; use fake providers and fake signer/sender.
- Existing harvested addresses are unverified observations, not proven profitable wallets.
- Do not modify or delete the user's existing VPS source/state until a source backup and state backup have been verified.

---

## Project Handling and File Map

The VPS project has no Git history, so create a sanitized working mirror under `D:\Project\bot\artificial\paperbot-ts` containing source, `package.json`, config schema/example, and tests only. Exclude `.env`, PM2 logs, keys, and live JSON state from the mirror. Before VPS deployment, create timestamped server-side backups of source/config/data and verify the backup can be read. Stage only changed TypeScript/build/config/test files to the VPS; preserve the existing `.env` and data files.

Local source layout:

- `src/main.ts` — composition root, shutdown, mode gate.
- `src/config/{schema.ts,load.ts}` — typed config and validation.
- `src/domain/{events.ts,wallet.ts,position.ts,execution.ts}` — provider-neutral types.
- `src/storage/{atomic-json.ts,state-store.ts,order-journal.ts}` — serialized JSON writes, safe recovery, idempotency.
- `src/providers/{solana-rpc.ts,pumpportal.ts,pump.ts,robinhood-rpc.ts,dexscreener.ts,rugcheck.ts,prices.ts}` — schema-validated I/O.
- `src/solana/{decode.ts,subscriptions.ts}` — transaction parsing, Pump/PumpSwap routing.
- `src/wallets/{discovery.ts,scoring.ts,lifecycle.ts}` — provenance, verification, tiers.
- `src/strategy/{risk.ts,solana-paper.ts,robinhood-paper.ts,exits.ts}` — pure decisions and simulation fills.
- `src/execution/{interface.ts,paper.ts,live-solana.ts,live-robinhood.ts,live-gate.ts}` — typed executors and lock.
- `src/telegram/{bot.ts,commands.ts,format.ts}` — validated commands and safe output.
- `test/**/*.test.ts`, `test/fixtures/` — offline unit/replay tests.
- `tsconfig.json`, `package.json`, `package-lock.json`, `.npmignore` — build/test scripts and dependency pinning.
- `deploy/ecosystem.config.cjs`, `docs/operations.md` — PM2 deployment and safe operator procedures.

## Task 1: Create the sanitized TypeScript working mirror and build/test harness

**Files:**
- Create: `paperbot-ts/package.json`, `paperbot-ts/tsconfig.json`, `paperbot-ts/.gitignore`
- Create: `paperbot-ts/src/main.ts`, `paperbot-ts/test/smoke.test.ts`
- Test: `paperbot-ts/test/smoke.test.ts`

**Interfaces:**
- Build command: `npm run build` emits `dist/` from `src/` with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Scripts: `npm test` runs `node --import tsx --test test/*.test.ts`; `npm run typecheck` runs `tsc --noEmit`; `npm run build` emits `dist/`.
- No `.env`, `data/`, PM2 logs, or generated `dist/` is copied into the local mirror.

- [x] **Step 1: Create a minimal failing smoke test** asserting the exported runtime mode is `paper` by default.
- [x] **Step 2: Run the single smoke test and confirm the intended missing-export failure.** Use only local files; do not run the VPS package test yet.
- [x] **Step 3: Add strict TypeScript/tooling config and a minimal `src/main.ts` that exports `resolveRuntimeMode(env)` with default `paper` and rejects unknown modes.**
- [x] **Step 4: Run `npm test` and `npm run build`; verify the test passes and output goes only to `dist/`.
- [ ] **Step 5: Commit the sanitized baseline and TypeScript harness** as `chore: stage sanitized Node paperbot source`.

## Task 2: Model config and make paper/live mode fail-closed

**Files:**
- Create: `src/config/schema.ts`, `src/config/load.ts`, `src/execution/live-gate.ts`, `test/config/*.test.ts`
- Modify: `src/main.ts`, `package.json`

**Interfaces:**
- `BotConfigSchema` validates chain flags, thresholds, position sizing, fees, slippage, and risk caps.
- `loadConfig(env, fileContents) -> Result<BotConfig, ConfigError>` redacts secrets and refuses `mode=live` without `ALLOW_LIVE_TRADING=true`, a fully valid risk policy, and explicit chain/router settings.
- `assertLiveGate(config, signerAvailability) -> void` throws `LiveModeLockedError` in paper mode and when any prerequisite is absent.

- [x] **Step 1: Write tests** for paper default, invalid config numbers, NaN/negative Telegram-edited values, missing live acknowledgement, missing signer, and secret redaction.
- [x] **Step 2: Run `npm test -- test/config` and confirm the new cases fail because the config contract is absent.**
- [x] **Step 3: Implement Zod schemas and safe config loading.** Keep source values in config separate from secret env values; never include secret values in `console.log` or object inspection.
- [x] **Step 4: Validate configuration before any network providers or execution adapters are constructed.**
- [x] **Step 5: Run config tests and TypeScript build; verify paper mode constructs only paper adapters.**
- [x] **Step 6: Commit** as `feat: validate config and lock live trading`.

## Task 3: Add typed domain models and provenance-aware wallet lifecycle

**Files:**
- Create: `src/domain/{events.ts,wallet.ts,position.ts,execution.ts}`
- Create: `src/wallets/{discovery.ts,scoring.ts,lifecycle.ts}`
- Modify: `src/walletScraper.ts` (ported to `src/wallets/`)
- Test: `test/wallets/*.test.ts`

**Interfaces:**
- `ObservedTrade` records signature, slot, commitment, signer, mint, quote mint/amount/decimals, venue, side, raw balances, source, and evidence confidence.
- `WalletEvidence` stores provider-reported metrics and independently reconstructed realized PnL in separate fields; missing provenance is never treated as verified.
- `WalletTier` is `verified | scout | excluded`; unverified/deployer wallets cannot receive verified Alpha sizing.
- `scoreWallet(evidence, policy) -> WalletScore` returns component scores and reason codes; it never fabricates PnL.

- [ ] **Step 1: Write tests** for provider-vs-onchain provenance, zero/fake old harvested metrics, deployer classification, insufficient sample, invalid address, and tier sizing.
- [ ] **Step 2: Run wallet tests and observe expected failures.**
- [ ] **Step 3: Port leaderboard fetch into an injected `WalletLeaderboardProvider`; validate payload shape and mark results `provider-reported`, not on-chain verified.**
- [ ] **Step 4: Change auto-harvest to persist observations only.** Harvested candidates get zero PnL, `verified=false`, bounded scout tier; creator/deployer observations become risk-only and are not buy triggers.
- [ ] **Step 5: Add a migration function that converts existing harvested records to unverified while preserving addresses, labels, observations, and history.** Do not delete or rewrite source state until a backup exists.
- [ ] **Step 6: Run tests and build; commit** as `feat: preserve wallet provenance and remove score inflation`.

## Task 4: Build transaction adapters and correct Pump/PumpSwap event parsing

**Files:**
- Create: `src/providers/{solana-rpc.ts,pumpportal.ts,pump.ts}`
- Create: `src/solana/{decode.ts,subscriptions.ts}`
- Modify: port `src/solanaListener.js` into the new modules.
- Test: `test/solana/{decode,subscription-routing,feed-recovery}.test.ts`, `test/fixtures/solana/`

**Interfaces:**
- `SolanaRpc` exposes typed `getTransaction`, `getAccountInfo`, and bounded history/backfill methods.
- `SolanaStream.subscribeWallets(addresses) -> AsyncIterable<SolanaUpdate>` reconnects with backoff, checkpoints signatures/slots, and signals unresolved gaps.
- `decodePumpTransaction(raw) -> Result<ObservedTrade[], DecodeError>` recognizes Pump bonding-curve and PumpSwap instructions separately, aggregates all token accounts per `(owner,mint)`, and deduplicates by signature/instruction.
- `PriceSubscriptionRouter.bind(subscriptionId, curveOrPool, mint)` routes only to the associated position; unknown subscription IDs are dropped and counted.

- [ ] **Step 1: Write fixtures/tests** for Pump buy/sell, PumpSwap buy/sell, failed transactions, versioned transactions, fee payer distinct from trader, multiple token accounts, duplicate updates, and unknown subscriptions.
- [ ] **Step 2: Run parser tests and confirm failures for the current string-log/first-account assumptions.**
- [ ] **Step 3: Implement typed transaction normalization from current official Pump SDK/IDL.** Do not infer trader solely from `accountKeys[0]`; select actual signers and correlate token balance deltas with instructions.
- [ ] **Step 4: Implement subscription response mapping and prevent account updates from changing unrelated mint prices.**
- [ ] **Step 5: Add retry/backfill cursor and fail-closed entry gate after an unreconciled gap.** Deduplicate signatures and do not process stale/reverted observations as confirmed copy signals.
- [ ] **Step 6: Run offline parser/recovery tests; commit** as `feat: decode and recover Pump trade streams`.

## Task 5: Correct risk filters, metadata safety, and quote freshness

**Files:**
- Modify: `src/safetyCheck.js` -> `src/providers/rugcheck.ts`, `src/solanaListener.js` -> new `src/solana/` modules
- Create: `src/providers/metadata.ts`, `test/safety/*.test.ts`

**Interfaces:**
- `SafetyResult` is `safe | unsafe | unknown`, never a boolean that conflates provider failure with safe.
- `validateMetadataUrl(url) -> URL` permits HTTPS only, rejects loopback/private/link-local/multicast IP ranges and unsafe redirects, and enforces response byte/time limits.
- `getFreshTokenQuote(mint, venue) -> FreshQuote | QuoteUnavailable` validates account owner/program, reserves, slot age, and venue; default prices are not tradable quotes.
- Liquidity policy compares actual reserve/pool liquidity (not market cap) against `min_liquidity_sol`/USD-equivalent thresholds.

- [ ] **Step 1: Write tests** for timeout/provider failure -> `unknown`, private URL and redirect rejection, oversized metadata, stale quote, invalid account owner, and insufficient pool reserves.
- [ ] **Step 2: Run safety tests to observe the current fail-open/SSRF/market-cap mismatch.**
- [ ] **Step 3: Implement URL and result validation.** Paper mode can proceed with explicitly labeled unverified scout sizing; live mode blocks on `unknown`.
- [ ] **Step 4: Wire socials metadata only through the constrained metadata adapter.**
- [ ] **Step 5: Run safety tests and build; commit** as `fix: fail safely on unknown token and quote data`.

## Task 6: Implement deterministic paper fills and correct position accounting

**Files:**
- Create: `src/strategy/{risk.ts,exits.ts,solana-paper.ts,robinhood-paper.ts}`
- Modify: port `paperEngine.js` and `robinhoodEngine.js` into typed paper engines.
- Test: `test/paper/{fills,sizing,scale-outs,exits,accounting}.test.ts`

**Interfaces:**
- `PaperExecutor.execute(order, quote, friction) -> PaperFill` records raw quote, estimated impact, fee, network cost, fill time, and uncertainty.
- `RiskPolicy.sizePosition(equity, exposures, requested) -> PositionSize | Rejected` always preserves safety floor and position caps; no minimum can exceed available risk budget.
- `ExitPolicy.targetMirror(currentRemaining, targetSellFraction) -> TokenAmount` scales partial target sells from remaining holdings; strategy TP fractions declare whether fraction is of initial or remaining quantity.
- `PositionAccounting.applyFill(position, fill) -> Position` is idempotent and fees are charged once per simulated order.

- [ ] **Step 1: Write deterministic tests** for sizing near the floor, entry friction, sell friction, repeated target partial sells, full exits, TP1 exact principal recovery, TP2, stop-loss, trailing stop, and stale quote blocking.
- [ ] **Step 2: Run paper tests and confirm current floor, fee, and repeated-trim defects.**
- [ ] **Step 3: Implement venue-specific fee schedules behind config:** Pump curve and PumpSwap separately; Robinhood pool fee and ETH gas separately. Mark assumptions/version in every simulated fill; do not claim exact live fills.
- [ ] **Step 4: Implement precise sell quantity semantics and serialize position transitions.** Concurrent price events must not double close/scale-out one position.
- [ ] **Step 5: Add deterministic fake quote provider**; tests must not invoke Binance/RPC/DexScreener.
- [ ] **Step 6: Run paper tests; commit** as `fix: make paper execution accounting deterministic`.

## Task 7: Harden Robinhood Chain event interpretation and paper market scanner

**Files:**
- Create: `src/providers/{robinhood-rpc.ts,dexscreener.ts}`
- Modify: port `robinhoodEngine.js` into `src/robinhood/` and paper strategy modules.
- Test: `test/robinhood/*.test.ts`

**Interfaces:**
- `decodeErc20Transfer(log) -> TransferEvent` is distinct from `decodeDexSwap(receipt, pool, wallet) -> SwapEvent`.
- `getDexSwapForWallet` confirms pool/route and direction before using a wallet action as a copy signal.
- `RobinhoodLiveAdapter` consumes validated router/pool config and remains behind the global live lock.

- [ ] **Step 1: Write tests** showing EOA transfer, airdrop, mint, and wallet-to-wallet transfer do not count as buys/sells; pool swaps do.
- [ ] **Step 2: Run tests and verify the current Transfer-topic heuristic fails those cases.**
- [ ] **Step 3: Parse DEX transaction receipts/logs and validate pair/pool address; only mirror sells for the copied wallet/position and compute proportional remainder.**
- [ ] **Step 4: Persist `lastCheckedBlock` only after a successful log fetch; retry the same range after RPC failure.**
- [ ] **Step 5: Keep DexScreener momentum trades explicitly tagged as a separate strategy from wallet-copy signals; use validated liquidity and staleness.**
- [ ] **Step 6: Fix scale-out/cash accounting and the Telegram close-summary variable; run tests and commit** as `fix: validate Robinhood swaps and state`.

## Task 8: Add serialized state persistence and safe recovery

**Files:**
- Modify: `src/storage.js` -> `src/storage/atomic-json.ts`, all state/config repositories.
- Create: `test/storage/*.test.ts`, `src/storage/order-journal.ts`

**Interfaces:**
- `StateStore.update(key, mutator) -> Promise<State>` serializes read-modify-write operations per state file.
- `atomicWriteJson(path, value)` writes a mode-0600 temp file in the same directory, syncs, atomically renames, and serializes concurrent writes.
- `readState(path, schema) -> State | RecoveryRequired` distinguishes missing state from corrupt state; corrupt positions are preserved in a quarantine backup and never silently replaced with initial balances.
- `OrderJournal` persists idempotency keys and pending/confirmed/failed/unknown execution records before any live submission.

- [ ] **Step 1: Write tests** for concurrent updates, concurrent writes, invalid JSON quarantine, safe startup blocking, mode preservation, and pending live-order timeout recovery.
- [ ] **Step 2: Run storage tests and confirm current safe-fallback/last-writer behavior.**
- [ ] **Step 3: Implement per-path write queues and validated state recovery.** Keep owner-only permissions and do not echo source data/secrets.
- [ ] **Step 4: Switch paper state, wallet files, and config writes to the repository; migrate existing JSON with a backup and schema version.**
- [ ] **Step 5: Run tests and parse all current JSON fixtures; commit** as `fix: serialize state and preserve recovery evidence`.

## Task 9: Implement live executors behind an unbypassable lock

**Files:**
- Create: `src/execution/{interface.ts,paper.ts,live-gate.ts,solana-live.ts,robinhood-live.ts,signer.ts,sender.ts}`
- Create: `test/execution/live-gate.test.ts`, `test/execution/live-adapters.test.ts`
- Modify: `src/main.ts`, `src/config/load.ts`

**Interfaces:**
- `Executor.execute(order, quote) -> ExecutionResult` is implemented by paper and live adapters.
- `LiveGate.assertEnabled(config, signer, orderJournal) -> void` requires `TRADING_MODE=live`, `ALLOW_LIVE_TRADING=true`, complete finite risk limits, allowlisted venue/router, fresh quote, no circuit breaker, and signer provider.
- `SolanaLiveExecutor` builds current Pump/PumpSwap instructions using the official SDK and records signature/status through `OrderJournal`.
- `RobinhoodLiveExecutor` uses only an explicitly configured, code-verified DEX router/pool and refuses unknown deployments/routes.

- [ ] **Step 1: Write tests** proving paper mode cannot construct a signer, paper execution never calls a sender, missing live flags fail, invalid router/mint/slippage fails, and a mocked sender gets idempotent order intents.
- [ ] **Step 2: Run tests and verify live paths are absent/locked.**
- [ ] **Step 3: Implement the real adapters with injected signer/sender interfaces.** Never load `.env` private keys in tests; use fake signers and senders only.
- [ ] **Step 4: Add startup assertion that the VPS's explicit `TRADING_MODE=paper` creates only PaperExecutor instances.** No mode may infer live from presence of a key.
- [ ] **Step 5: Run adapter tests and audit logs for key redaction; commit** as `feat: add locked live execution adapters`.

## Task 10: Harden Telegram commands, mode labels, and operator recovery

**Files:**
- Modify: port `telegram.js` into `src/telegram/{bot.ts,commands.ts,format.ts}`.
- Create: `test/telegram/*.test.ts`, `docs/operations.md`
- Modify: `src/main.ts`, `package.json`, `deploy/ecosystem.config.cjs`

**Interfaces:**
- `parseCommand(text) -> BotCommand` uses explicit commands/buttons, validates numeric bounds, and does not turn arbitrary words containing “start/stop” into control commands.
- `escapeTelegramHtml(text) -> string` escapes token metadata/labels before formatting.
- `/status` reports actual runtime mode, feed freshness, data gaps, and simulation-only results; `/sellall` closes paper positions on both engines and cannot call live senders in paper mode.

- [ ] **Step 1: Write tests** for malicious labels/metadata, invalid/NaN/negative config values, authorized chat enforcement, pause/resume, both-engine sell-all, and truthful paper status.
- [ ] **Step 2: Run command tests and observe current parsing/formatting defects.**
- [ ] **Step 3: Implement validated command parsing, HTML escaping, and atomic config save.**
- [ ] **Step 4: Add PM2 build/start scripts:** compile to `dist/`, PM2 runs `node --env-file=.env dist/main.js`, and tests/build never depend on live env credentials.
- [ ] **Step 5: Write operator docs** for data provenance, paper assumptions, secret permissions, backup/restore, restart, and the explicit future process for enabling live mode.
- [ ] **Step 6: Run offline test suite and strict build; commit** as `fix: harden controls and paper-mode reporting`.

## Task 11: Safe VPS rollout and full verification

**Files:**
- Create: timestamped backup under a user-approved server backup directory (source/config/data only; protect permissions).
- Modify: VPS project source/build artifacts only after backup verification.
- Test: all offline tests; paper shadow smoke test using read-only feeds.

- [ ] **Step 1: Verify source backup and JSON state backup** by hashes and parsing; do not copy `.env` into the local mirror.
- [ ] **Step 2: Run `npm test` in a deterministic offline environment.** Test configuration must stub HTTP/RPC/price sources and leave no temporary artifact behind.
- [ ] **Step 3: Run `npm run typecheck`, `npm run build`, and `node --check dist/main.js`.**
- [ ] **Step 4: Deploy compiled build and schema migrations while keeping `TRADING_MODE=paper`; preserve existing position balances/closed history and classify legacy harvested records as unverified.**
- [ ] **Step 5: Restart PM2 (user allowed downtime), check online status, feed reconnect counters, state parseability, and that no transaction signer/sender was instantiated.**
- [ ] **Step 6: Run a paper shadow session with captured/live read-only feeds and review decision reasons/estimated costs; never use mainnet broadcast.**
- [ ] **Step 7: Confirm rollback instructions and commit the implementation** as `feat: harden dual-chain TypeScript paper bot`.

## Plan Self-Review

- **Spec coverage:** TypeScript/build (Tasks 1, 10); config/live lock (Tasks 2, 9); wallet provenance (Task 3); Pump/PumpSwap decode and routing (Task 4); safety/SSRF/quotes (Task 5); realistic simulation/exits (Task 6); Robinhood transfer-vs-swap and fills (Task 7); atomic state/recovery (Task 8); locked live adapters (Task 9); Telegram/PM2 and deployment (Tasks 10–11).
- **Completeness scan:** Provider credentials are deployment inputs, not unresolved implementation steps. Live mode stays disabled on the VPS; no private key is required for paper mode.
- **Type consistency:** `ObservedTrade`, `WalletEvidence`, `PaperExecutor`, `LiveGate`, `OrderJournal`, `StateStore`, and typed configuration are introduced before downstream tasks consume them.
- **Scope:** Both paper engines and future live adapters are in scope; no actual live transaction is permitted in this rollout.

## Execution Handoff

Run inline task-by-task with TDD. Do not use subagents. Keep the user informed before any VPS backup, file deployment, PM2 restart, or migration; the user has authorized downtime but not exposure of `.env` secrets or use of real funds.
