# Bell5 Public Verification and Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Bell5's public pool-verification and integration surfaces, their onchain/read APIs and evidence, plus an audit and bug-bounty preparation pack.

**Architecture:** Keep `BellHookV2` immutable and add stateless, hook-bound `BellSwapLens` instances that read deployed policy, flow-budget, calendar, and auction state. Extend the existing Worker pool directory with bounded receipt indexing, then expose each pool's lens and receipts through public web routes and a CLI verifier. Keep all live transaction evidence, verification status, and third-party submission status sourced from real receipts or returned acknowledgements.

**Tech Stack:** Solidity 0.8.26, Foundry, TypeScript/viem, Next.js 16, Cloudflare Worker/Durable Objects, Vitest, Node test runner, Blockscout.

**Spec:** `C:\Users\sifaq\Downloads\Telegram Desktop\Bell5.md`

## Global Constraints

- Robinhood Chain Mainnet chain ID is `4663`; never use testnet addresses as Mainnet evidence.
- Do not modify or redeploy immutable `BellHookV2` for read-only status features.
- New contracts have no proxy and must achieve explorer **full match** before being described as verified.
- `getSwapStatus` must match actual swap outcomes for REGULAR, CLOSED, UNKNOWN, auction-active, and over-cap states.
- All public numbers come from onchain reads or the indexer and link to their source transaction/address.
- Use honest `LIVE`, `DEPLOYED`, `TESTNET`, and `PLANNED` labels; do not claim third-party acceptance until acknowledged.
- Do not fabricate Mainnet transactions, audit completion, bounty amounts, or external application status.

---

### Task 1: Add BellSwapLens and parity tests

**Files:**
- Create: `contracts/src/BellSwapLens.sol`
- Create: `contracts/src/interfaces/IBellSwapLens.sol`
- Create: `contracts/test/integration/verification/BellSwapLens.t.sol`
- Read: `contracts/src/BellHook.sol`, `contracts/src/BellHookV2.sol`, `contracts/src/BellPolicyOracle.sol`, `contracts/src/BellModeEvaluator.sol`, `contracts/src/auction/BellAuctionRegistry.sol`, `contracts/src/registries/CalendarRegistry.sol`, `contracts/src/types/ProtocolTypes.sol`

**Interfaces:**
- `getSwapStatus(bytes32 poolId, bool zeroForOne, uint256 amountIn) external view returns (SwapStatus memory)`
- `getPoolInfo(bytes32 poolId) external view returns (address hook, uint16 hookFlags, bool hasAuction, address auction)`
- `SwapStatus` fields follow Bell5 exactly: `allowed`, `reason`, `session`, `currentFeePips`, `maxIn0`, `maxIn1`, `auctionWindow`, `nextTransition`.

- [ ] Write Foundry tests for REGULAR, CLOSED, UNKNOWN, auction-active, over-cap, both swap directions, and unbound pool.
- [ ] Run `forge test --match-contract BellSwapLensTest -vvv`; confirm the new interface tests fail before implementation.
- [ ] Implement a stateless reader over the existing hook policy/state, cap buckets, auction registry, and calendar leaves; do not add storage, owner, proxy, or hook changes.
- [ ] Re-run the focused tests and compare `allowed/reason` with real PoolManager swap simulation in every required state.
- [ ] Run `forge test --match-path 'test/integration/verification/BellSwapLens.t.sol' -vvv` and `forge build`.

### Task 2: Add the public chain verifier CLI

**Files:**
- Create: `scripts/verify-bell.ts`
- Create: `scripts/verify-bell.test.mjs`
- Modify: root `package.json` only if needed to expose `pnpm verify:bell`
- Read: `scripts/auction-cli/bell-verify.mjs`, `evidence/deploy/mainnet-4663.json`, `evidence/deploy/mainnet-4663-broadcast.json`, `evidence/deploy/mainnet-4663-factory-update.json`, `deployments/rule-tests.json`, and historical factory address in `docs/CURRENT-STATE.md`.

- [ ] Add fixture-based tests for pool discovery, hook-mask checks, fee receipt decoding, and recorded revert lookup.
- [ ] Run `node --test scripts/verify-bell.test.mjs`; confirm tests fail for missing CLI behavior.
- [ ] Implement public-RPC-only reads across every documented BELL Mainnet factory generation: discover each factory's `PoolCreated` events, confirm `PoolManager.Initialize`, print poolId/tokens/hook, derive `flags = Number(BigInt(hook) & 0x3fff)`, assert permission bits 9/8/0 are off, read latest `Swap.fee` by the hook's historical session phase, and report rule-test receipts/revert errors.
- [ ] Emit readable terminal PASS/FAIL rows and `verify-output.json`; fail nonzero on an invariant failure or incomplete required evidence.
- [ ] Re-run `node --test scripts/verify-bell.test.mjs` and `pnpm verify:bell` against a public RPC.

### Task 3: Index pool receipts and expose a bounded Worker endpoint

**Files:**
- Modify: `workers/keeper-b/src/index.ts`
- Modify or create: `workers/keeper-b/src/pool-receipts.mjs`
- Modify or create: `workers/keeper-b/test/pool-receipts.test.ts`
- Modify: `workers/keeper-b/wrangler.jsonc` only if a binding/migration is required.

- [ ] Add tests for Initialize/Swap/auction receipt normalization, cursor pagination, invalid pool IDs, and unknown pool responses.
- [ ] Run `pnpm --filter @bell/keeper-b exec vitest run test/pool-receipts.test.ts`; verify red before implementation.
- [ ] Index and retain per-pool `Initialize`, `Swap` including fee, and auction events with block/hash/log index and explorer URL.
- [ ] Add `GET /pools/:poolId/receipts`, validating a 32-byte pool ID, bounding page size and scan ranges, returning stable chronological receipts, and using existing cache/error/CORS conventions.
- [ ] Re-run focused tests and the full Worker suite; run `wrangler deploy --dry-run` to check bundle/bindings.

### Task 4: Add pool verification and `/verify` web routes

**Files:**
- Create: `apps/web/app/(app)/pool/[poolId]/page.tsx`
- Create: focused pool verification component under `apps/web/components/pool/`
- Create: `apps/web/app/verify/page.tsx`
- Create: focused route/component tests under `apps/web/test/`
- Modify: `apps/web/app/(app)/pools/page.tsx` to link each pool to its verification route.
- Read: `apps/web/AGENTS.md`, relevant Next 16 docs, `apps/web/components/policy/PoolCard.tsx`, `apps/web/app/proof/page.tsx`, `apps/web/lib/` chain configuration.

- [ ] Add tests for missing/invalid pool IDs, unavailable live status, fee-by-session receipts, and source-link rendering.
- [ ] Run the focused web tests and `pnpm --filter @bell/web typecheck`; establish expected failures before implementation.
- [ ] Show pool creation transaction, hook address/flags/PASS, latest Swap fee evidence by session, rule-test receipts, CLOSED withdrawal, auction receipts where present, and current status from `BellSwapLens`.
- [ ] Add `/verify` with the four 60-second checks and links to the CLI, source, Blockscout, and real example transactions.
- [ ] Render honest unavailable/partial states and responsive layout; do not display hard-coded live values.
- [ ] Run focused tests, `pnpm --filter @bell/web typecheck`, and `pnpm --filter @bell/web build`.

### Task 5: Complete Robinhood Chain Mainnet rule tests and Universal Router rehearsal

**Files:**
- Modify: `deployments/rule-tests.json`
- Modify: `scripts/lp-proof/build-rule-tests.mjs` and its tests if schema support is needed
- Create or modify: a reviewed script under `scripts/lp-proof/` for each missing rule/standard-router rehearsal.
- Evidence: `evidence/lp-proof/mainnet-*.json` with chain ID, input, receipt, block, revert selector or decoded error.

- [ ] Inspect live pool/auction state and simulate each exact call before any Mainnet broadcast.
- [ ] Run tests for `PolicyBlocked`, `AuctionActive`, CLOSED withdrawal, and per-session `Swap.fee` evidence (REGULAR, PRE/POST, OVERNIGHT, CLOSED) only where the deployed calendar and source state permit.
- [ ] Exercise a small swap through the canonical Uniswap Universal Router with empty hookData; record whether it succeeds and whether hookData is required.
- [ ] Keep each transaction separately simulated, signed, broadcast, and receipt-verified; use no fabricated/pending tx data as success.
- [ ] Rebuild `deployments/rule-tests.json` from receipt evidence and validate it with `node --test scripts/lp-proof/*.test.mjs`.

### Task 6: Publish the reusable integration pack

**Files:**
- Create: `apps/web/app/integrations/page.tsx`
- Create: `apps/web/public/integrations/pools.json` or a generated public endpoint if a checked-in snapshot would be stale
- Create: `docs/integrations/README.md` with Markdown and PDF export source
- Modify: `workers/keeper-b/src/index.ts` only if a live pool-list response needs additional safe fields.

- [ ] Test the integration data schema for pool ID, tokens, hook, auction binding, session fees, reason selectors, and source links.
- [ ] Generate pool data from live chain/indexer evidence; include observation block and timestamp.
- [ ] Document quote-before-route via `BellSwapLens.getSwapStatus`, custom errors, session/fee schedule, auction timing, standard router example, contract source, and `/verify`.
- [ ] Label snapshots by observation time and expose stale/error status rather than presenting old data as current.
- [ ] Verify `/integrations` and downloadable artifacts build and all referenced addresses/links resolve.

### Task 7: Prepare the audit package and bounty program draft

**Files:**
- Create: `docs/audit/README.md`
- Create: `docs/audit/architecture.md`
- Create: `docs/audit/invariants.md`
- Create: `docs/audit/scope-and-known-issues.md`
- Create: `docs/audit/auction-flow.md`
- Create: `docs/audit/run-tests.md`
- Create: `docs/bug-bounty/draft.md`
- Read: `contracts/test/integration/factory/LossOfFundsIndex.t.sol` and the complete Bell5 in-scope list.

- [ ] List the exact in-scope contract names and deployed addresses, compiler settings, commit, dependencies, and out-of-scope components.
- [ ] Write explicit invariants for unblockable LP exit, escrow settle/refund, no proxies, and fail-closed behavior; link each to tests.
- [ ] Document architecture, auction state flow, known issues, test commands, and `LossOfFundsIndex.t.sol`.
- [ ] Create the bounty draft with scope, severity framework, safe PoC rules, no testing against real user funds, confidential reporting, and a clearly unresolved reward schedule for team decision.
- [ ] Research and record 2–3 auditor candidates with fit, availability/contact path, and source links; do not imply a selection or audit booking.

### Task 8: Deploy and fully verify BellSwapLens on Robinhood Chain

**Files:**
- Create: `contracts/script/DeployBellSwapLens.s.sol` or the repository-standard equivalent.
- Modify: Mainnet deployment manifest/evidence only after successful receipts; record a poolId→Lens mapping for every live pool.
- Read: current Mainnet manifest, deployer setup, verifier configuration, and chain verification tooling.

- [ ] Run all contract tests/build, deployment dry-run, bytecode-size check, and constructor-address review.
- [ ] Confirm chain ID `4663`, signer address, current balance, dependency code, and exact deployment cost before broadcast.
- [ ] Broadcast one immutable, no-proxy Lens instance per live hook only after those checks; record each tx hash, block, constructor args, poolId, hook, and Lens address.
- [ ] Verify every instance's source on Blockscout and require **full match**. If full match fails, diagnose compiler/metadata and do not call it verified.
- [ ] Read each Lens back from Mainnet and run parity checks against its bound live pool.

### Task 9: Release, external application tracking, and final verification

**Files:**
- Modify: integration/verification status data with actual deploy/Worker/web deployment results.
- Create: `docs/integrations/submission-status.md`.

- [ ] Publish the Worker and web app only after local tests, public-RPC validation, and manifest review pass.
- [ ] Verify production `/verify`, `/pool/<poolId>`, `/integrations`, Worker receipt endpoint, and all linked explorer transactions.
- [ ] Prepare submission packets for DEX Screener, GeckoTerminal, fomo, GMGN, 1inch, 0x, KyberSwap, and Odos from the same integration pack.
- [ ] Submit through official channels where available and record date, destination, payload/link, and acknowledgement; otherwise record the exact blocker and prepared packet without claiming submission.
- [ ] Run `pnpm check`, `pnpm evidence:check`, focused Foundry/Worker/web tests, `git diff --check`, and `pnpm verify:bell`; archive outputs.
- [ ] Review final changes against every Bell5 deliverable and keep any incomplete third-party approval, audit engagement, bounty reward, unavailable session evidence, or failed deployment explicitly marked.
