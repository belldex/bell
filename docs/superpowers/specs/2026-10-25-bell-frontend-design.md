# BELL Frontend — Design Spec (M11)

Date: 2026-10-25 · Code location: `apps/web` · Status: user-approved (option 1, Obsidian + cool accent)

## 1. Tujuan
One integrated Next.js application: cinematic landing page at `/` + dApp (`/pools`, `/pool`, `/swap`, `/create`, `/positions`).
Follows `BELL-Implementation-Plan-Final.md` M11-01…M11-05 and the UI contract in brief §20.K.

## 2. Constraints (from the brief)
- Static export (`output: 'export'`), tanpa server API baru. Pool dinamis memakai `/pool/?id=…`.
- Tanpa `NEXT_PUBLIC_*` selain allowlist `scripts/tooling/secret-boundary.mjs`. Tanpa login token launch / Supabase Auth.
- All large numbers are decimal strings (>2^53). No fake USD NAV for SESSION_ONLY.
- CLASS, frozen/live source, age, and budget must be visible before signing.
- Required SESSION_ONLY disclaimer: **"Session controls only; no independent price protection for the counterasset."**
- Temporary data = fixtures with the same types as the 20.K response; the UI always displays a **PREVIEW DATA** banner until connected to a real deployment (no contracts have been deployed yet).
- Do not modify files outside `apps/web` (+ workspace lockfile, this spec document). Codex is still working on contracts/packages/workers.

## 3. Visual language — "Obsidian Bourse"
| Token | Value | Notes |
|---|---|---|
| bg-0 / bg-1 | `#05070A` / `#0A0E14` | obsidian |
| surface / surface-2 | `#0F1520` / `#151D2B` | glass cards |
| border | `#1E2A3B` | hairline |
| text / muted / dim | `#E8EEF7` / `#8A98AD` / `#5B687C` | kontras ≥ 4.5:1 |
| **accent (Ion Cyan)** | `#3CE6FF` | replaces gold; strong `#12B8D9`, deep `#0B5E73` |
| session | REGULAR cyan · PRE `#7DB2FF` · POST `#9A8CFF` · OVERNIGHT `#5566C9` · CLOSED `#9FB0C7` | also distinguished by icons/labels, not color alone |
| semantics | up `#34D399` · down `#F87171` · warn `#FBBF24` | status only, not brand |

Tipografi: **Instrument Serif** (display), **Inter Tight** (UI), **JetBrains Mono** (angka/data).
Icons: lucide-react (UI) + react-icons (brand/chain glyph). Tailwind v4 with `@theme` tokens.

## 4. Motion (GSAP + ScrollTrigger + Lenis)
- Lenis smooth scrolling synchronized with ScrollTrigger; disabled when `prefers-reduced-motion` is set.
- Hero: pinned, layer parallax (grid / bell / halo), headline di-scrub (scale/blur/opacity).
- **Bell Clock**: pinned ±500vh, scrub waktu 1 minggu → cincin 24 jam berputar, fase/fee/budget berubah (angka fee asli 0,05/0,30/0,50/1,00%).
- **Bell Fee decay**: SVG path scrub menggambar kurva `bellFee = base + ceil((10000-base)·max(0,300-t)/300)`.
- **Weekend episode**: pinned, budget bar only decreases (never refills), stages captureClose → frozen anchor → reopen+60s.
- Kartu class + arsitektur: parallax horizontal/vertikal berlapis.
- Reduced motion: all sections display statically, without pinning.

## 5. Halaman
| Route | Isi |
|---|---|
| `/` | Hero, Bell Clock, Fee decay, Weekend episode, 2 classes, isolation/architecture, "not promised", CTA |
| `/pools` | Directory + filter class/sesi/pair, kartu Bell Clock mini per pool |
| `/pool/?id=` | Policy view lengkap: per-stock phase, fee efektif, budgets (rolling/closure), anchor age, timers, lifecycle, indexed-through block/hash, disclosures |
| `/swap` | Exact-in/out, quote (fixture), slippage, deadline ≤120s, quote expiry ≤30s, fee breakdown, state tx (approve/submit/provisional/finalized), wrong-chain guard |
| `/create` | 5-step wizard: pair → class/reference → caps (raw units) → seed/price preview → review (49 USDG fee, predicted hook/PoolId) |
| `/positions` | Posisi LP, fee accrued, add/remove/collect, jalur exit in-kind meski halted, disclosure risiko |

Shell: nav + wallet (EIP-1193/viem, chain 4663 / 46630), status bar (indexed-through, data source), skip link, error boundary, read-only mode.

## 6. Struktur
```
apps/web/
  app/(site)/page.tsx            landing
  app/(app)/{pools,pool,swap,create,positions}/page.tsx
  components/{landing,app,wallet,policy,ui}/
  lib/{fixtures,policy,format,wallet,motion}/
  public/assets/*                gambar hasil generate
```

## 7. Verifikasi
`tsc --noEmit`, `next build` (export), cek browser (Chrome DevTools) di 375/768/1024/1440, reduced-motion, keyboard focus.
