# Always-on Oracle Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline task-by-task with verification checkpoints.

**Goal:** Keep both BELL pool classes while allowing swaps 24/7, falling back to bounded AMM-only execution when oracle protection is unavailable.

**Architecture:** Keep `PRICE_GUARDED` price-band enforcement when both independent references are fresh. Add an explicit fallback policy state that suppresses only the unavailable price guard, uses existing maximum fee and tightest flow caps, and never exposes stale references as healthy. `SESSION_ONLY` remains explicitly AMM-only. Preserve safety pauses and invalid-configuration failures.

**Tech Stack:** Solidity 0.8.26, Foundry, TypeScript/Next.js, Cloudflare Worker, pnpm, Vercel and Wrangler deployment tooling.

**Spec:** `docs/superpowers/specs/2026-10-31-always-on-oracle-fallback.md`

## Global Constraints

- Keep the existing Robinhood Chain Mainnet chain ID 4663 and admitted asset registry.
- Preserve emergency pool/token pause checks and malformed dependency fail-closed behavior.
- Use maximum configured LP fee 10,000 units (1%) and strictest current flow limits (1/5 trade cap, 1/4 rolling window cap) in degraded AMM-only fallback.
- Do not report stale prices as valid independent references or describe fallback as price-protected.
- Deploy immutable contracts only after local acceptance and deployment preflight; verify there is still no live Mainnet pool before changing the factory template.

---

### Task 1: Normalize and inspect the existing local draft

**Files:** Existing modified contract, lifecycle tests, Create UI, status banner, landing copy, and any status layout files.

- [ ] Compare every dirty file against HEAD; retain changes that implement the approved fallback and identify unrelated status/layout changes before staging.
- [ ] Read the applicable Next.js `use client` and app-router guidance from the installed Next.js docs before editing UI code.
- [ ] Record current deployed addresses, Worker routes, factory class support, and `/pools`/`/status` state without exposing private values.

### Task 2: Specify the protection-state API and contract tests

**Files:** `contracts/src/types/ProtocolTypes.sol`, `contracts/src/BellPolicyOracle.sol`, `contracts/src/BellHook.sol`, `contracts/src/BellModeEvaluator.sol`, `contracts/test/unit/hook/BellHookLifecycle.t.sol`, `contracts/test/unit/hook/BellHookClosure.t.sol`, `packages/protocol/generated/abi-manifest.json`.

- [ ] Add failing cases for fresh guarded execution, stale guarded fallback, missing reference fallback, closed/no-anchor fallback, strict pause behavior, maximum fee, tightest caps, and no exposed stale reference.
- [ ] Run each focused Foundry test to confirm it fails for the intended behavior before implementing that behavior.
- [ ] Add an explicit policy protection state (`ACTIVE`, `FALLBACK`, `NOT_APPLICABLE`) or an equivalently typed, ABI-stable representation; use the same representation in onchain policy and API.

### Task 3: Implement contract fallback

**Files:** The contract and ABI files listed in Task 2 plus `contracts/test/integration/factory/PriceGuardedCreation.t.sol` if factory wiring needs changes.

- [ ] Preserve fresh guarded reference and price-path checks.
- [ ] When required references are missing/stale, mark fallback, remove stale reference values, use the maximum existing fee, and force the strictest existing flow limits.
- [ ] Allow planned CLOSED and overnight stale-feed fallback without requiring a close anchor for AMM-only execution; maintain pause, asset, calendar-integrity, lifecycle, and delta accounting checks.
- [ ] Keep `SESSION_ONLY` permanently `NOT_APPLICABLE` for external price protection while retaining its existing class constraints.
- [ ] Run focused Foundry red/green tests after each policy change, then the complete contract suite.

### Task 4: Wire UI and public status

**Files:** `apps/web/app/(app)/create/page.tsx`, `apps/web/lib/mainnet-create-flow.ts`, `apps/web/app/(app)/swap/page.tsx`, swap components, `apps/web/components/app/MainnetSessionFeedStatus.tsx`, `apps/web/components/app/MainnetStatusBanner.tsx`, landing copy, Worker `/pools` and policy serializers, ABI manifest/tests.

- [ ] Keep both class cards available; `PRICE_GUARDED` explains normal protection and the bounded AMM-only fallback; `SESSION_ONLY` explains permanent AMM-only pricing.
- [ ] Read protection state from the deployed hook/Worker, display a conspicuous degraded state before wallet confirmation, and show fee/flow limits from live policy.
- [ ] Update Worker pool serialization and UI ABI decoding without fabricating empty pools or healthy feed status.
- [ ] Add focused tests for fallback-state rendering, both class options, and worker/API serialization; run app and Worker suites.
- [ ] Render the Create/Swap screens at desktop and mobile widths and correct any clipping or wrapping.

### Task 5: Build, review, and deploy

**Files:** Mainnet factory-upgrade script/config/evidence and deployment docs only where needed.

- [ ] Run `pnpm compile:solidity`, full `pnpm test:contracts`, `pnpm test:unit`, Worker tests/build, app production build, ABI/policy/evidence checks, and `git diff --check`.
- [ ] Verify no user funds or pools exist on the currently active factory and run the deployment script in dry-run mode.
- [ ] Deploy the replacement oracle/evaluator/hook deployer/factory using existing Mainnet deployment tooling; update the Mainnet evidence and Worker/UI config; deploy Worker and web app.
- [ ] Verify onchain code/config hashes, Worker `/status`, Worker `/pools`, app production Create options, fallback policy display, and deployment readiness. Record all transaction hashes, addresses, and checks.
