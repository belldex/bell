# Demo Runbook — 3 Pool dari UI

Dana: 160 USDG dari PM. Semua langkah dari UI, tanpa CLI.

## Target

| Pool | Seed | Counter | Tipe |
|---|---|---|---|
| 1 | AAPL | USDG | Market price |
| 2 | NVDA | USDG | Market price |
| 3 | TSLA | USDG | Market price |

Alamat wallet: `0x6C3659988bd5f9E94F927B3FD7d0Ee3746f8d399` (Robinhood Chain 4663)

## Sebelum mulai

- [ ] 160 USDG sudah masuk wallet
- [ ] Wallet terhubung di Robinhood Chain (4663)
- [ ] Buka https://bell-black.vercel.app/create/

## Pool 1 — AAPL / USDG

1. Stock: **AAPL**, Counter: **USDG**
2. Pool type: **Market price**
3. Seed: **0.0025 AAPL** dan **0.9 USDG** (harga ~$344/ share)
4. Review → cap otomatis: ~0.00025 AAPL per swap
5. Approve AAPL → Approve USDG → **Create**
6. Tunggu receipt — catat tx hash

Cek: https://bell-black.vercel.app/pools/ harus menampilkan pool.

## Pool 2 — NVDA / USDG

Sama seperti di atas, seed **0.0048 NVDA** + **1 USDG**.

## Pool 3 — TSLA / USDG

Sama, seed **0.0025 TSLA** + **1 USDG**.

## Setelah 3 pool jadi — Swap demo

1. Buka https://bell-black.vercel.app/swap/
2. Pilih pool AAPL/USDG
3. Swap kecil: **0.0002 AAPL** (~$0.07, di bawah cap 0.00025)
4. Quote → Approve → Submit
5. Ini membuktikan jalur swap jalan **tanpa Chainlink**

## Tarik (withdraw) demo

1. Buka https://bell-black.vercel.app/positions/
2. NFT posisi terdeteksi otomatis
3. **Remove liquidity** → pilih 50%
4. **Isi minimum output untuk kedua token** (wajib, tidak boleh 0)
5. Submit — token kembali ke wallet in-kind

## Catatan biaya

| Item | USDG |
|---|---|
| Seed 3 pool | ~3 |
| Service fee 3 × 49 | 147 |
| **Total pakai** | **~150** |
| Sisa buffer | ~10 |

Service fee masuk ke wallet `0x58Cd82a008cB9a6c0c605991b40a09BD6aa1a6fC` — milikmu sendiri.

## Jika ada error

| Pesan | Arti |
|---|---|
| `insufficient allowance` | Approval belum dilakukan atau kurang |
| `TradeCapExceeded` | Swap terlalu besar — kecilkan jumlah (cap = 10% seed) |
| `MinimumAmountInsufficient` | Minimum output withdraw terlalu tinggi — turunkan |
| Saldo 0 di readiness | Dana belum masuk / salah jaringan |
