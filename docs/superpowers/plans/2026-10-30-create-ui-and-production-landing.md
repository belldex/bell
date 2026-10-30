# Mainnet Pool Creation UI and Production Landing Implementation Plan

> **For agentic workers:** Use inline task-by-task execution in this session. Each task ends with focused verification before moving to the next.

**Goal:** Enable a wallet-driven Mainnet pool creation flow and make the public landing and legal copy reflect current production state.

**Architecture:** Keep the wizard UI separate from a browser-safe create adapter that reads the deployed registries/factory, prepares exact calldata, and runs explicit EIP-1193 wallet transactions. Use the existing quote Worker only for signed bundles. Update the routed Gyevo landing and the legal routes without changing the pool or quote contracts.

**Tech Stack:** Next.js 16 static export, TypeScript, viem, Wagmi wallet provider, Cloudflare quote Worker, generated ABI manifest.

**Spec:** `docs/superpowers/specs/2026-10-30-create-ui-and-production-landing-design.md`

## Global Constraints

- Chain ID is `4663`; only admitted AAPL, NVDA, TSLA, USDG, and WETH can be selected.
- Yahoo reporter keys stay in the Cloudflare Worker; the app only consumes signed bundles.
- Never submit a transaction without an explicit user wallet action.
- Simulate the exact factory request after fresh health is committed and before `createAndSeed`.
- Re-check the 120-second health window, chain, account, balances, and factory nonce before creation.
- Do not create or seed a Mainnet pool during implementation.
- Landing claims must distinguish deployed contracts/Worker from absent pools/liquidity/swaps and unverified data rights/audit.

---

### Task 1: Browser-safe create request and admission helpers

**Files:**
- Create: `apps/web/lib/mainnet-create.ts`
- Modify: `apps/web/lib/mainnet-live.ts`
- Test: `apps/web/test/mainnet-create.test.mjs`
- Modify: `apps/web/test/homepage.test.mjs`

**Interfaces:**
- `resolveAdmittedPair(stockSymbol, counterSymbol)` returns the exact two admitted token descriptors, sorted by token address with descriptor IDs kept attached.
- `buildMainnetCreateRequest(input, reads)` returns the normalized pool config, exact factory request, required allowance map, and displayed seed/fee/gas amounts.
- `mineBrowserHookSalt(input)` returns the CREATE2 request salt and predicted valid hook address using the same namespace and permission mask as the deployment script.
- `validateCreateReadiness(input)` returns actionable preflight errors, never a permissive boolean for unknown descriptors or references.

- [ ] Write tests that reject unknown/inactive assets, duplicate pairs, unadmitted counterassets, incomplete stock updates, invalid cap ordering, and stale health.
- [ ] Run only the focused test and confirm these cases fail because the helper is absent.
- [ ] Implement the admitted asset map from reviewed Mainnet evidence, live descriptor verification, sorted config building, and browser-safe salt miner using viem keccak only.
- [ ] Add vectors matching `mainnet-pool-config.mjs` for token ordering, profile hash, seed-derived price, reference-derived price, and hook flag mask.
- [ ] Run focused tests and Web TypeScript check.

### Task 2: Wallet transaction orchestration for create-and-seed

**Files:**
- Create: `apps/web/lib/mainnet-create-flow.ts`
- Modify: `apps/web/app/(app)/create/page.tsx`
- Modify: `apps/web/lib/mainnet-live.ts`
- Test: `apps/web/test/mainnet-create-flow.test.mjs`

**Interfaces:**
- `runCreatePreflight({ publicClient, account, selection })` verifies chain, calendars, descriptors, factory profile, class/reference support, service fee, wallet balances, and gas before any write.
- `prepareCreateHealth({ publicClient, walletClient, account, pair, quoteUrl })` obtains one signed Worker bundle per stock leg, calls `applyPoolOracleUpdates`, and returns the confirmed update timestamp and hash.
- `submitCreatePool({ publicClient, walletClient, account, prepared, selection })` rechecks nonce/health, simulates the exact request, submits `createAndSeed`, waits for success, validates factory events and position recipient, and returns explorer links.
- Each approval/wrap/health/create transaction is a separate explicit stage; stage state is surfaced to the page.

- [ ] Write tests for required allowance amounts (including USDG seed plus service fee), bundle completeness, expired health, changed account/chain, failed simulation, reverted receipt, and success-event validation.
- [ ] Run the focused tests and verify failure before implementation.
- [ ] Implement the sequential flow: required approvals only, optional user-confirmed WETH wrap for exact shortfall, fresh quote/health transaction, exact simulation, then factory transaction.
- [ ] Replace illustrative ticker lists/prices with only admitted assets, live metadata/reference reads, and exact token-unit inputs; keep unsupported asset intake out of the live transaction path.
- [ ] Replace disabled Create button with connect/switch-chain/preflight/confirm actions and stage progress, transaction hashes, error recovery, and a post-create link to the new pool.
- [ ] Run focused tests and TypeScript check.

### Task 3: Mainnet-accurate landing and legal copy

**Files:**
- Modify: `apps/web/components/landing/gyevo/sections.tsx`
- Modify: `apps/web/components/landing/gyevo/landing-nav.tsx`
- Modify: `apps/web/components/landing/gyevo/final-reveal.tsx`
- Modify: `apps/web/components/landing/gyevo/cover-reveal.tsx`
- Modify: `apps/web/app/(app)/terms/page.tsx`
- Modify: `apps/web/app/(app)/privacy/page.tsx`
- Test: `apps/web/test/homepage.test.mjs`

- [ ] Add assertions against stale claims: testnet-only, no Mainnet deployment, sample pools, create/swap disabled, and old testnet snapshot labeling.
- [ ] Run the focused homepage test and verify the claims are found before edits.
- [ ] Update the routed landing status section and hero/footer CTA to Mainnet deployment facts with explicit empty-pool state and static snapshot date.
- [ ] Update terms and privacy pages to explain wallet-driven swaps/create, transaction and RPC processing, and current no-pool/no-liquidity state.
- [ ] Run the focused homepage test and confirm obsolete copy is absent from served components and legal routes.

### Task 4: Production verification and docs

**Files:**
- Modify: `docs/CURRENT-STATE.md`
- Modify: `README.md`
- Verify: `apps/web` production export and live public endpoints.

- [ ] Update app capability/current release statements while preserving the fact that no pool has yet been created.
- [ ] Run focused create and landing tests, web TypeScript check, production build, and `git diff --check`.
- [ ] Confirm static export includes `/create`, `/pools`, `/swap`, and legal routes.
- [ ] Verify Worker `/pools` and all configured `/quote?symbol=` endpoints remain HTTP 200; inspect response shape only, never print signatures or secrets.
- [ ] Confirm the work has not sent a Mainnet transaction and report whether pool creation is now available from the deployed UI.
