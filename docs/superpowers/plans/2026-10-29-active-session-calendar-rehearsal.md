# Active-Session Calendar Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover a phase-correct Yahoo testnet rehearsal on the newly admitted stock identity, only after calendar proofs and transaction simulations validate.

**Architecture:** Keep phase selection and quote validation pure and tested. Update the existing calendar/setup script to build one active-phase calendar for the fresh asset, verify the proof locally, simulate every write, and read state back after broadcasting. Do not touch the superseded asset's root or claim success from local evidence.

**Tech Stack:** Node.js ESM, viem, existing BELL calendar hashing/proof helpers, Yahoo quote and EIP-712 attestation modules, Node test runner.

## Global Constraints

- Only operate on the newly admitted asset in `evidence/deploy/testnet-46630-asset-queue.json`.
- Yahoo phase must equal the active calendar phase; PRE is never relabeled REGULAR.
- No calendar/report write is broadcast unless its exact request passes `simulateContract` first.
- Preserve old pool and calendar evidence as historical evidence until new onchain readback succeeds.
- A claim of `canSwap=true` requires a fresh onchain policy read.

---

### Task 1: Pure active-phase calendar selection and tests

**Files:**
- Modify: `scripts/deploy/keeper-price-config.mjs`
- Modify: `scripts/deploy/keeper-price-config.test.mjs`
- Test: `scripts/deploy/keeper-price-config.test.mjs`

**Interfaces:**
- Consumes: Yahoo phase strings `PRE`, `REGULAR`, `POST`; calendar phase values `1`, `2`, `3`.
- Produces: tested helper returning the supported calendar phase and admitted wire for a quote phase, or `null` for unsupported/closed phases.

- [ ] **Step 1: Write failing mapping tests** for PRE→phase 1/extended wire, REGULAR→phase 2/regular wire, POST→phase 3/extended wire, and CLOSED→null.
- [ ] **Step 2: Run** `node --test scripts/deploy/keeper-price-config.test.mjs`; verify the new exports are missing and failures are expected.
- [ ] **Step 3: Implement** the smallest pure phase-selection helper using existing phase/wire mapping conventions.
- [ ] **Step 4: Run** the same test command; verify all phase tests pass.

### Task 2: Make calendar setup use current phase and simulate writes

**Files:**
- Modify: `scripts/deploy/setup-calendar-and-price.mjs`
- Test: add focused pure tests to `scripts/deploy/keeper-price-config.test.mjs` if boundary logic is shared.

**Interfaces:**
- Consumes: fresh Yahoo quote, chain timestamp, new asset ID, active manifest/registry, admitted adapter evidence.
- Produces: a calendar leaf covering chain time, an inclusion proof/root, phase-matched direct/stream samples, and a sequence of simulated then broadcast writes.

- [ ] **Step 1: Add failing tests** for active-phase interval construction: current phase is supported, `start <= now < end`, end is after start, and a phase mismatch/stale quote is rejected.
- [ ] **Step 2: Run** the focused Node tests and confirm expected failures.
- [ ] **Step 3: Implement** calendar leaf construction from the observed active Yahoo phase and chain time. Use existing calendar builder/hash functions where applicable; locally verify leaf proof/root before creating requests. Remove the fixed `now < 13:30 UTC` PRE-only gate.
- [ ] **Step 4: Add exact-request simulations** before `queueRoot`, `activateRoot`, `activateInterval`, direct publication, stream submission, and health refresh. Stop before any write when a simulation fails.
- [ ] **Step 5: After each receipt, read back** active interval, phase, sample, and health; abort if values differ from the simulated intent.
- [ ] **Step 6: Run** focused tests and syntax check: `node --test scripts/deploy/keeper-price-config.test.mjs` and `node --check scripts/deploy/setup-calendar-and-price.mjs`.

### Task 3: Run fresh-asset calendar/price stage

**Files:**
- Runtime: `.env` (local only; never stage)
- Evidence updated only by existing scripts after successful onchain reads.

**Interfaces:**
- Consumes: fresh admitted asset `0x99525af3649889aa1ea9c274ebca4838b83f8816185b9257919c603ef6266139`, its adapters, and Robinhood testnet RPC.
- Produces: active calendar root/interval and fresh phase-matched direct + stream observations.

- [ ] **Step 1: Read-only preflight**: verify chain ID 46630, current block timestamp, fresh Yahoo phase/age, and current/next interval for the new descriptor.
- [ ] **Step 2: Run calendar setup** only if quote freshness, expected active phase, and all write simulations pass.
- [ ] **Step 3: Verify onchain** interval identity/phase/time coverage, report phase/feed/age, health reason bits, and transaction receipts.
- [ ] **Step 4: Run** `BELL_EXPECTED_CALENDAR_PHASE=2 node scripts/deploy/final-testnet-acceptance.mjs` when current phase is REGULAR; use the observed phase value if the session changes. Do not proceed if any check fails.

### Task 4: Create pool, maintain health, swap, and acceptance

**Files:**
- Existing scripts only: `scripts/deploy/create-pool-with-fresh-health.mjs`, `scripts/deploy/create-testnet-pool.mjs`, `scripts/deploy/keeper-price.mjs`, `scripts/deploy/swap-live-pool.mjs`, `scripts/deploy/final-testnet-acceptance.mjs`.

**Interfaces:**
- Consumes: the fresh asset/calendar and phase-matched Yahoo reports from Task 3.
- Produces: fresh pool evidence, a confirmed swap receipt/balance delta, and final phase-specific acceptance output.

- [ ] **Step 1: Create/seed** only after existing factory simulation and fresh-health preflight pass.
- [ ] **Step 2: Run keeper** with its explicit gas override only while Yahoo quotes are fresh; stop on hard transaction/RPC failure and retain exact logs.
- [ ] **Step 3: Read pool policy**; execute the rehearsal swap only when onchain `canSwap=true` and `reasonBits=0`.
- [ ] **Step 4: Verify receipt and balances** and ensure evidence points to the new pool, not the historical pool.
- [ ] **Step 5: Rerun** phase-specific final acceptance; require every check to pass.
- [ ] **Step 6: Update** `docs/CURRENT-STATE.md` to separate prior and latest pools, state active phase and snapshot time, and label the stock as a rehearsal fixture.

### Task 5: Full verification

**Files:**
- No new files.

- [ ] **Step 1: Run** `pnpm check`; require exit code 0.
- [ ] **Step 2: Run** `git diff --check`; require no whitespace errors.
- [ ] **Step 3: Run** `pnpm check:secrets`; require no credentials in tracked files.
- [ ] **Step 4: Confirm** `git status` contains only intended BELL changes and that `.env` is ignored.
