# BELL Full Implementation Design

**Date:** 2026-10-24  
**Normative product specification:** `BELL-Developer-Brief-Final.md`  
**Implementation sequencing and acceptance evidence:** `BELL-Implementation-Plan-Final.md`

## Purpose and scope

Implement the complete BELL product described by the two final documents, not a REGULAR-only pilot. Scope includes both `PRICE_GUARDED` and `SESSION_ONLY`; all supported market sessions and planned closures; stock/stable, stock/crypto, stock/unpriced-counterasset, and stock/stock pools; immutable per-pool hooks; factory and direct router; public noncustodial LP positions and the restricted treasury path; registries, keepers, indexer, API/SDK, frontend, operations, and release evidence.

The Developer Brief is normative for product behavior and security. The Implementation Plan governs module boundaries, task ordering, tests, and evidence. A conflict is recorded and resolved in favor of the brief; no implementation may choose a looser rule. A documented or modeled rule is not evidence that production code passed it.

## Architecture and trust boundaries

- **Onchain authority:** immutable hook instances, PoolManager integration, registries, calendar commitments, safety controller, factory/router, public PositionManager flows, and treasury-only adapter. Chain state is authoritative for funds, policy, and accepted source data.
- **Offchain derived services:** Supabase Postgres/API/Edge Functions/Cron for derived state and Keeper A; Cloudflare Durable Object/Worker for independent Keeper B; bounded indexer; static Next.js frontend. Caches and API responses never override onchain policy.
- **External dependencies:** authenticated Alchemy and Pinax RPC, entitled source access, canonical token/source contracts, and free-tier platform quotas. No public RPC fallback, paid auto-upgrade, or hidden paid infrastructure.
- **User and governance boundaries:** wallet signs user swaps/LP actions; public LP positions remain user-owned. Governance is typed and delayed; guardian can pause but cannot sweep principal or reset budgets. Token-launch wallets and `$BELL` integrations are not dependencies.

## Critical behavior invariants

1. `PRICE_GUARDED` requires approved independent price sources and exact band/repricing checks. `SESSION_ONLY` does not claim fair-price protection for an unpriced counterasset.
2. Active freshness, planned CLOSED, unexpected closure, issuer pause, corporate changes, and recovery are distinct branches. Only a valid planned closure with a pre-close anchor can use the CLOSED path; unexpected closure fails closed.
3. Gross per-currency rolling and closure-episode budgets use actual swap deltas and never refill on direction reversal, time/calendar rollover, LP changes, pause/resume, or partial reopen.
4. Pool activation requires atomic factory deployment, explicit-liquidity seed, actual principal measurement excluding accrued fees, successful settlement, cap checks, then activation. Any failure reverts the request.
5. LP removal/collection in-kind is independent of BELL swap health and governance pause; external token/core failures remain disclosed dependency risks.
6. Source, RPC, quota, or platform failure is reported as unavailable/blocked, never fabricated as healthy. Signed transaction retries reuse the same raw transaction and nonce until reconciled.
7. Every release claim is bound to exact code/config/source evidence and candidate commit. Model tests, scaffold builds, or documentation do not satisfy EVM, live, audit, or operational gates.

## Delivery sequence

Follow M00–M15 and task dependencies in the Implementation Plan: reproducible foundation; source/RPC preflight; canonical types and fixtures; adapters/registries/calendar/safety; math/fees/budgets; hook state machine; factory/router/public LP/treasury; database/RLS; API/SDK; independent keepers; canonical indexer/reorg; full frontend; backup/monitoring/quota admission; complete system verification; testnet/live evidence/audit/retest; and only then gated mainnet/canary/public handover.

Work that can be implemented or tested offline proceeds without secrets. Authenticated source/RPC, live testnet, long-duration traces, licensed data rights, audit, funding, and deployment are explicit evidence dependencies. When unavailable, record the task/gate as blocked or missing; do not substitute mocks or model results as live evidence. The owner will receive a consolidated list of environment inputs only after offline implementation work is complete.

## Verification approach

Use the test layers specified by the brief and plan: generated ABI/codec vectors; unit and negative tests; fuzz and stateful invariants; real pinned v4 core/periphery integration; authenticated pinned forks; cross-runtime, SQL/RLS, Worker/DO and browser E2E; capacity/source traces; backup/restore and incident drills; independent full-scope audit and retest. Pin toolchain/dependencies before claiming reproducibility. A failed, skipped, unavailable, or unrun check remains visibly failed/blocked/not-run.

## Workspace boundary

All project edits are confined to `D:\Project\wealthypeople\BELL`. The Git root is `D:\Project` and contains unrelated working-tree changes; do not stage, modify, reset, or commit those paths. Avoid broad staging. Do not broadcast mainnet transactions, enable paid services, or acquire/send credentials as part of implementation.
