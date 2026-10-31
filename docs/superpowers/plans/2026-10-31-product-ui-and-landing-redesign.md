# BELL Product UI and Landing Redesign Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with the TDD cycle. This plan is being executed inline in the current session.

**Goal:** Present a consistent, logo-forward BELL market terminal and an accurate landing page for the current Mainnet product.

**Architecture:** Reuse the existing `LogoSelect`, `TokenLogo`, and `TokenPair` primitives. Refine app routes and the shared app shell without changing protocol behavior. Recompose landing content in the existing Gyevo presentation system and preserve its responsive/reduced-motion fallbacks.

**Tech Stack:** Next.js 16, React 19, Tailwind 4, scoped CSS, Node test runner, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-31-product-ui-and-landing-redesign.md`

## Global Constraints

- Robinhood Chain Mainnet chain ID is `4663`.
- MEME is `SESSION_ONLY` only and has no independent price reference.
- The live Mainnet pool directory is empty at the verified snapshot; no Mainnet swap has completed.
- Never invent live price, liquidity, balance, users, APR, audit or data-rights claims.
- Keep exact token-unit arithmetic and transaction semantics unchanged.
- Preserve keyboard, screen-reader, reduced-motion and mobile support.

---

### Task 1: Logo-forward asset and pool selectors

**Files:** `apps/web/app/(app)/create/page.tsx`, `apps/web/app/(app)/swap/page.tsx`, `apps/web/components/ui/LogoSelect.tsx`, `apps/web/test/homepage.test.mjs`

- [ ] Add assertions that Create uses `LogoSelect` with per-token symbols and Swap uses pair-logo options.
- [ ] Run the focused homepage tests and confirm the new assertions fail against the native selectors.
- [ ] Replace the two Create native asset selectors with `LogoSelect`; preserve current selection, duplicate-pair adjustment, admitted asset/type detail, and class eligibility behavior.
- [ ] Replace Swap's pool `<select>` with `LogoSelect`; option detail includes pool class and tradability while keeping the selected hook and resetting quotes on change.
- [ ] Run homepage tests and the web typecheck.

### Task 2: Consistent app hierarchy and responsive task pages

**Files:** `apps/web/components/app/AppShell.tsx`, `apps/web/app/(app)/app.css`, `apps/web/app/(app)/pools/page.tsx`, `apps/web/app/(app)/pool/page.tsx`, `apps/web/app/(app)/swap/page.tsx`, `apps/web/app/(app)/create/page.tsx`, `apps/web/app/(app)/positions/page.tsx`, `apps/web/app/(app)/protocol/page.tsx`, `apps/web/test/homepage.test.mjs`

- [ ] Add route-level assertions for live states, risk copy, and major navigation/action links; run to confirm failures before changing markup.
- [ ] Refine page headings, metadata, grids, selection panels, empty/error/loading states, and action placement using the existing BELL design tokens.
- [ ] Make the mobile sidebar and desktop navigation state clear; keep the scheduled market preview explicitly labeled as a preview.
- [ ] Keep pool caps, validUntil, exact-output maximum paid, remove minimums, and all transaction safety copy visible.
- [ ] Run focused tests, web typecheck and the production build.

### Task 3: Grounded landing narrative

**Files:** `apps/web/components/landing/gyevo/landing-page.tsx`, `apps/web/components/landing/gyevo/cover-reveal.tsx`, `apps/web/components/landing/gyevo/sections.tsx`, `apps/web/components/landing/gyevo/feature-story.tsx`, `apps/web/components/landing/gyevo/final-reveal.tsx`, `apps/web/components/landing/gyevo/landing.css`, `apps/web/test/homepage.test.mjs`

- [ ] Add landing assertions for wallet product pathways, empty Mainnet pool status, MEME's class restriction, rights/audit unknowns, and explicit snapshot labeling; run and confirm they fail where content is absent.
- [ ] Rework the page progression to explain the product, supported pool classes/assets, create/swap/LP journeys, risks and verified status without duplicating claims.
- [ ] Replace stale explanatory copy and date labels; distinguish policy diagrams and fee curve examples from live pool/fee state.
- [ ] Keep motion illustrative, preserve reduced-motion/noscript paths, and check small-screen readability and CTA availability.
- [ ] Run focused landing tests, typecheck and production build.

### Task 4: Full verification and production release

**Files:** all changed files

- [ ] Run `pnpm --filter @bell/web run typecheck`.
- [ ] Run the focused `node --test apps/web/test/homepage.test.mjs` suite.
- [ ] Run `pnpm --filter @bell/web run build` and `git diff --check`.
- [ ] Review the final diff for unsupported claims, inaccessible controls, and styling regressions.
- [ ] Commit and push `main` under the existing production-push authorization.
- [ ] Verify the Vercel status and inspect deployed Create, Swap, landing, and Positions assets for the new content.
