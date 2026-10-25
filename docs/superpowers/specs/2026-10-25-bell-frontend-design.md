# BELL Frontend — Design Spec (M11)

Tanggal: 2026-10-25 · Lokasi kode: `apps/web` · Status: disetujui user (opsi 1, Obsidian + accent dingin)

## 1. Tujuan
Satu aplikasi Next.js terintegrasi: landing sinematik di `/` + dApp (`/pools`, `/pool`, `/swap`, `/create`, `/positions`).
Mengikuti `BELL-Implementation-Plan-Final.md` M11-01…M11-05 dan kontrak UI brief §20.K.

## 2. Batas yang dipegang (dari brief)
- Static export (`output: 'export'`), tanpa server API baru. Pool dinamis memakai `/pool/?id=…`.
- Tanpa `NEXT_PUBLIC_*` selain allowlist `scripts/tooling/secret-boundary.mjs`. Tanpa login token launch / Supabase Auth.
- Semua angka besar sebagai string decimal (>2^53). Tidak ada fake USD NAV untuk SESSION_ONLY.
- CLASS, source frozen/live, age, budget wajib terlihat sebelum signature.
- Disclaimer SESSION_ONLY wajib: **"Session controls only; no independent price protection for the counterasset."**
- Data sementara = fixtures bertipe sama dengan respons 20.K; UI selalu menampilkan banner **PREVIEW DATA** selama belum terhubung deployment nyata (belum ada kontrak ter-deploy).
- Tidak mengubah file di luar `apps/web` (+ lockfile workspace, docs spec ini). Codex masih mengerjakan contracts/packages/workers.

## 3. Visual language — "Obsidian Bourse"
| Token | Nilai | Catatan |
|---|---|---|
| bg-0 / bg-1 | `#05070A` / `#0A0E14` | obsidian |
| surface / surface-2 | `#0F1520` / `#151D2B` | glass cards |
| border | `#1E2A3B` | hairline |
| text / muted / dim | `#E8EEF7` / `#8A98AD` / `#5B687C` | kontras ≥ 4.5:1 |
| **accent (Ion Cyan)** | `#3CE6FF` | pengganti emas; strong `#12B8D9`, deep `#0B5E73` |
| session | REGULAR cyan · PRE `#7DB2FF` · POST `#9A8CFF` · OVERNIGHT `#5566C9` · CLOSED `#9FB0C7` | dibedakan juga oleh ikon/label, bukan warna saja |
| semantik | up `#34D399` · down `#F87171` · warn `#FBBF24` | hanya untuk status, bukan brand |

Tipografi: **Instrument Serif** (display), **Inter Tight** (UI), **JetBrains Mono** (angka/data).
Ikon: lucide-react (UI) + react-icons (brand/chain glyph). Tailwind v4 dengan token `@theme`.

## 4. Motion (GSAP + ScrollTrigger + Lenis)
- Smooth scroll Lenis tersinkron dengan ScrollTrigger; dimatikan bila `prefers-reduced-motion`.
- Hero: pinned, layer parallax (grid / bell / halo), headline di-scrub (scale/blur/opacity).
- **Bell Clock**: pinned ±500vh, scrub waktu 1 minggu → cincin 24 jam berputar, fase/fee/budget berubah (angka fee asli 0,05/0,30/0,50/1,00%).
- **Bell Fee decay**: SVG path scrub menggambar kurva `bellFee = base + ceil((10000-base)·max(0,300-t)/300)`.
- **Weekend episode**: pinned, budget bar hanya turun (tidak pernah refill), tahapan captureClose → frozen anchor → reopen+60s.
- Kartu class + arsitektur: parallax horizontal/vertikal berlapis.
- Reduced motion: semua section tampil statis, tanpa pin.

## 5. Halaman
| Route | Isi |
|---|---|
| `/` | Hero, Bell Clock, Fee decay, Weekend episode, 2 class, isolasi/arsitektur, "tidak dijanjikan", CTA |
| `/pools` | Directory + filter class/sesi/pair, kartu Bell Clock mini per pool |
| `/pool/?id=` | Policy view lengkap: per-stock phase, fee efektif, budgets (rolling/closure), anchor age, timers, lifecycle, indexed-through block/hash, disclosures |
| `/swap` | Exact-in/out, quote (fixture), slippage, deadline ≤120s, quote expiry ≤30s, fee breakdown, state tx (approve/submit/provisional/finalized), wrong-chain guard |
| `/create` | Wizard 5 langkah: pair → class/reference → caps (raw units) → seed/price preview → review (fee 49 USDG, predicted hook/PoolId) |
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
