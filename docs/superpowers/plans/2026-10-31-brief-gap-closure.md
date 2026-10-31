# BELL Brief Gap Closure Implementation Plan

> **For agentic workers:** Execute inline task by task; verify each task before proceeding.

**Goal:** Finish the code and operations needed to close documented brief/plan gaps, including the exact pinned MEME counterasset path.

**Architecture:** Keep AssetRegistry as the only authority for admitted tokens. Pin MEME by address and evidence, expose it in Create only after the deployed registry confirms its descriptor, and reject unknown assets. Complete exact-output and policy/LP detail in the existing wallet UI; preserve direct onchain execution.

**Tech Stack:** Solidity ABI manifests, Node/viem scripts, Next.js/TypeScript, viem, Cloudflare Worker, node:test, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-brief-gap-closure-design.md`

## Global constraints

- Mainnet chain ID is 4663.
- MEME is `0x385F4f8ae47651ce5F58F5265395a669f8281e18`, symbol `MEME`, decimals 18.
- MEME is unpriced and only eligible for SESSION_ONLY.
- Never allow a non-admitted token into a factory call.
- Preserve wallet ownership, user minimums, receipt checks, and honest no-pool state.

---

### Task 1: Pin and verify MEME admission evidence

Create a reproducible read-only preflight and evidence manifest for token, implementation, registry, and controller state. Test the manifest parser and abort behavior for identity drift. Run against Mainnet without broadcasting.

### Task 2: Add staged counterasset admission tooling

Add status, queue, and activate commands. Queue simulates and is resumable; activate reads the operation's live ETA/expiry/status and simulates. Persist no private material. Tests cover unauthorized signer, unverified candidate, drift, premature activation, and idempotency.

### Task 3: Enable admitted MEME in Create

Add MEME to the admitted counterasset manifest only after verifying its active descriptor on chain. Update UI options and live descriptor checks. Show SESSION_ONLY-only and no-independent-price warnings; provide a custom-address intake check that cannot create with unadmitted assets.

### Task 4: Complete swap modes

Implement exact-input and exact-output Router simulation, output/minimum or input/maximum display, approval amount calculation, quote expiry, and fee breakdown. Add helper tests for bound math and UI tests for each mode.

### Task 5: Complete pool state display

Render live phase, validity/freshness, flags/reasons, per-leg trade/rolling/closure limits, reference values, created block, and directory's indexed-through block. Add safe unit formatting and tests.

### Task 6: Complete position reporting

Read balances and principal/output estimates from verified PoolManager state, fee growth when derivable, and show unknown values as unavailable. Add minimum output controls to remove; retain direct PositionManager settlement and receipt checks. Add tests for tick/range amount math and no fabricated accrued fees.

### Task 7: Align docs and release evidence

Update README, current state, landing, and brief/plan traceability. Record what is complete and what still needs licensed source evidence, independent audit, capacity/restore drills, real browser-wallet transactions, and product acceptance.

### Task 8: Verify, deploy, and push

Run unit, Worker, typecheck, Next build, Worker dry-run, read-only live checks, and `git diff --check`. Broadcast only the explicitly authorized, reviewed MEME admission after queue/activation preflights pass; verify the active descriptor. Deploy Worker if changed, commit, push, and check both Vercel deployments.
