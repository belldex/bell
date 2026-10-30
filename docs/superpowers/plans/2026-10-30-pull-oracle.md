# BELL Pull Oracle Implementation Plan

> **For agentic workers:** use inline task-by-task execution in this session. Each task ends with focused verification before moving to the next.

**Goal:** Let all BELL stock pools obtain fresh signed reports on demand, with no scheduled Mainnet report transactions while idle.

**Architecture:** The Worker exposes signed quote bundles only. A new SessionRegistry helper atomically publishes the direct sample, submits phase reports, and refreshes stock health. The Router transports optional updates in `hookData`; the Hook validates pool membership, applies updates, and preserves existing policy/recovery behavior. A permissionless prepare endpoint handles recovery after health expires.

**Tech Stack:** Solidity 0.8.26, Uniswap v4 hooks/router, Foundry, TypeScript Cloudflare Worker, viem, Vitest, Next.js.

**Spec:** `docs/superpowers/specs/2026-10-30-pull-oracle-design.md`

## Global Constraints

- Do not change the deployed 120-second report-age limit or the existing 60-second recovery separation.
- Preserve support for AAPL, NVDA, and TSLA; stock/stock pools require one update per stock side.
- Chainlink reference adapters remain read-only price inputs.
- Keep Yahoo reporter keys server-side; quote responses may contain signatures but never private keys.
- Do not broadcast transactions or deploy Worker/contract changes to Mainnet in this implementation.

---

### Task 1: Atomic pull update in SessionRegistry

**Files:** `contracts/src/registries/SessionRegistry.sol`, its protocol interfaces, and the SessionRegistry unit/integration tests.

**Deliverable:** `refreshStockWithReports(assetId, directSample, directSignature, reports)` validates and publishes the direct sample, applies the existing report batch validation/replay rules, and refreshes health atomically. It accepts only admitted stock descriptors and reuses the descriptor's pinned direct adapter.

- [x] Add a failing test proving the helper updates direct sample, stream sample, and health in one call.
- [x] Add failing cases for non-stock assets, bad signatures, wrong asset/feed/phase, stale reports, and replay.
- [x] Run the focused Foundry test and confirm the new success case fails because the helper is absent.
- [x] Implement the shared internal report-submission path and the atomic helper.
- [x] Run focused SessionRegistry Foundry tests and the existing Yahoo adapter/registry tests.

### Task 2: Pull payload through Router and Hook

**Files:** `contracts/src/types/ProtocolTypes.sol`, `contracts/src/BellRouter.sol`, `contracts/src/BellHook.sol`, hook interfaces, router/hook tests.

**Deliverable:** An optional `OraclePullUpdate[]` is included in `SwapRequest`, covered by the request hash, and passed through v4 `hookData`. The Hook applies updates only to stock asset IDs bound to that pool before policy evaluation. An update may include the canonical upcoming CLOSED leaf hash; the Hook may capture that anchor during the registry's five-minute pre-close window after reports are applied. If no caller does so, closed-phase swaps remain fail-closed until a valid anchor exists. `prepareOracleUpdates()` commits health and recovery checkpoints without attempting a swap. Callback hashes bind the exact hook payload across before/after swap.

- [x] Add failing router/hook tests for nonempty valid payload forwarding and invalid payload rejection.
- [x] Add failing tests proving a pool cannot update a stock asset outside its bound legs and that optional pre-close anchor capture is caller-bound and validated.
- [x] Add failing recovery tests: one observation after expiry starts recovery; a second advanced observation at least 60 seconds later releases it; successful ACTIVE pull swaps advance the same health-continuity deadline without bypassing a real gap.
- [x] Update the router callback payload and request hash; make the Hook decode and validate the documented structure.
- [x] Implement the permissionless preparation path and preserve fail-closed swap policy.
- [x] Run focused Foundry router, factory, hook, and recovery suites.

### Task 3: Worker signed-quote endpoint, no Mainnet broadcast

**Files:** `workers/keeper-b/src/index.ts`, keeper quote/tick helpers, Wrangler config generator, Worker tests.

**Deliverable:** `/quote?symbol=<configured-symbol>` reads the active calendar, fetches Yahoo, refuses stale/phase-mismatched or already-consumed observations, and returns signed direct/stream payloads. On Mainnet, the alarm path is disabled in pull mode; testnet push mode remains unchanged. Quote endpoint performs reads/signing only and needs no transaction private key.

- [x] Add failing tests for each supported symbol, unknown symbols, closed/unsupported phase, stale/mismatched quote, and repeated observation.
- [x] Add failing test proving Mainnet pull mode never calls wallet `writeContract`.
- [x] Implement the quote service and multi-asset phase selection.
- [x] Add the evidence-bound pull-mode config and remove the Mainnet relayer secret requirement from the pull setup output.
- [x] Run the complete keeper Worker Vitest suite and Wrangler dry-run.

### Task 4: Client request encoding and preparation UX

**Files:** Web swap request types/builders and tests; deployment/acceptance scripts that encode `SwapRequest`.

**Deliverable:** The shared request codec and Mainnet request builder encode signed bundles for a pool's stock legs; `mainnet-swap` can fetch fresh bundles from the quote service and include them in the Router request. A new explicit Mainnet prepare command handles both pre-pool SessionRegistry health priming and post-pool Hook recovery checkpoints, with simulation as default and `--broadcast --i-authorize-spend` required to write. It can optionally include the upcoming CLOSED leaf hash during the pre-close window. All three stock symbols remain available; each pool requests only its own stock legs. The current web swap page is explicitly a fixture preview, so do not imply it can execute live swaps or wire it to the quote endpoint in this task.

- [x] Add failing tests for single-stock and stock/stock pull bundle encoding and request hash binding.
- [x] Implement quote retrieval and payload construction without exposing secrets.
- [x] Add client-facing preparation/recovery helpers and a plan-only-by-default prepare command for the initial Registry update and subsequent Hook recovery. Keep explicit broadcast authorization and document the two-observation wait. Keep the fixture-only web UI non-executable and accurately labeled.
- [x] Update scripts to use the new request ABI and preserve existing no-broadcast defaults.
- [x] Run focused web/script tests and verify the full three-stock config remains generated.

### Task 5: Evidence, docs, and final static checks

**Files:** `docs/CURRENT-STATE.md`, `docs/MAINNET-DEPLOY.md`, keeper runbook, pull design/plan.

- [x] Document the pull flow, gas payer, 120-second expiry, 60-second recovery, and explicit Mainnet deployment boundary.
- [x] Regenerate ABI/build artifacts only through existing project commands if required.
- [x] Run `git diff --check`, syntax/build checks, and the focused suites produced by tasks 1–4.
- [x] Confirm this work has not submitted Mainnet transactions or deployed Cloudflare changes.
