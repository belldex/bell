# BELL Landing GYEVO Scroll Story Implementation Plan

> **For agentic workers:** Execute this plan inline in the active task. The user has directed a close structural recreation of GYEVO's landing choreography as BELL's first baseline.

**Goal:** Rebuild BELL's landing-page flow to follow GYEVO's cover, overlapping pinned chapter, pinned three-scene feature story, regular-flow explanation sections, and closing reveal while preserving BELL product copy, routes, and 3D identity.

**Architecture:** Keep the existing Three.js scene, but make its pose, object morph, camera, and visual emphasis interpolate directly from scroll position. Recompose the landing into a sticky cover, an overlapping pinned three-state policy chapter, normal-flow explanatory chapters, a separately pinned three-scene BELL story, and normal-flow details/closing content. Use CSS custom properties driven by one RAF-scheduled scroll reader; provide stacked layout for small/short screens and reduced motion. Keep all new styles scoped to the landing.

**Tech Stack:** Next.js App Router, React, TypeScript, existing Three.js scene, existing GSAP/Lenis dependencies only where already applicable, Tailwind utilities, scoped CSS.

**Spec:** User-approved request in this conversation: study GYEVO's code and recreate its scroll-driven story and pinned scene mechanics closely as BELL's first state; keep BELL content and routes.

## Global Constraints

- Do not change BELL app routes, protocol logic, contract behavior, or unrelated workspace files.
- Do not add generated bitmap assets; keep the existing code-rendered Three.js art and build supporting story visuals with HTML/CSS/SVG.
- Scroll position is the source of truth for all pinned progress; scrolling backwards must reverse the same transitions.
- Pin only when viewport and motion preferences allow it; preserve readable stacked content on mobile, short screens, and reduced-motion settings.
- Keep direct navigation anchors and an obvious Open App path.
- Do not add or run tests unless the user asks; use a typecheck and local preview for verification.

---

### Task 1: Recompose the landing chapters and navigation

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/landing/SiteNav.tsx`
- Modify: `apps/web/app/globals.css` (append landing-scoped styles only)

**Deliverable:** The page follows the GYEVO order: scroll-driven cover; overlapping pinned policy comparison; ordinary-flow explanation; pinned three-scene market/risk/close story; ordinary-flow fee/pool details; closing CTA and existing footer. Desktop navigation points to the three story anchors and has an obvious app CTA.

### Task 2: Make the BELL 3D scene truly scroll-scrubbed

**Files:**
- Modify: `apps/web/components/landing/Scene.tsx`

**Deliverable:** Read normalized progress from landing pose markers and interpolate object positions, block visibility, hot marks, camera scale/offset/rotation, and dimming continuously in the render loop. Remove per-pose elapsed-time transition delays. Keep static behavior for reduced motion and gracefully tolerate WebGL failure.

### Task 3: Connect pinned story state and responsive fallbacks

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/components/landing/SiteNav.tsx`

**Deliverable:** A dedicated pinned BELL feature runway holds a sticky stage while three distinct CSS/SVG product diagrams and copy crossfade according to scene progress. Active navigation and direct hash anchors remain in sync. On narrow screens, short viewports, and reduced motion, the chapters become stacked readable content.

### Task 4: Verify the saved implementation and preview

**Files:**
- Inspect: changed landing files only.

**Checks:** Run the web app typecheck, inspect the local browser preview at desktop and mobile widths, and inspect the diff to ensure no unrelated workspace edits were changed. Do not run test suites.
