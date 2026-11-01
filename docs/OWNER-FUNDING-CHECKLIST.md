# Owner Funding Checklist — Mainnet 4663

Ringkasan kebutuhan dana untuk membuat pool pertama BELL di Robinhood Chain Mainnet.
Semua angka onchain dibaca 2026-10-31. Tidak ada langkah deploy kontrak.

## 1. Dua wallet, dua peran

| Wallet | Alamat | Fungsi | Saldo sekarang |
|---|---|---|---|
| Deployer / pembuat pool | `0x6C3659988bd5f9E94F927B3FD7d0Ee3746f8d399` | bayar gas + 49 USDG, tanda tangan create | 0.001644 ETH |
| Service recipient | `0x58Cd82a008cB9a6c0c605991b40a09BD6aa1a6fC` | terima service fee | 0 ETH |

**Batasan kontrak:** `BellPoolFactory.sol:200` menolak `msg.sender == serviceRecipient`.
Pool **harus** dibuat dari wallet deployer, bukan dari wallet service recipient.

## 2. ETH untuk gas

Gas price saat ini: **0.020034 gwei**.

| Keperluan | Perkiraan gas | Biaya |
|---|---|---|
| Approve token (per token) | ~50k | ~0.000001 ETH |
| Create + seed pool | 3–6 juta | ~0.00006–0.00012 ETH |
| Cadangan aman | — | **0.001 ETH** |

Saran top-up deployer: **0.003–0.005 ETH**.
Wallet service recipient butuh **~0.0005 ETH** untuk menarik fee nanti.

## 3. Token seed

Harga reference onchain:

```
AAPL  $344.91      NVDA  $205.28      TSLA  $399.39
WETH  $2247.76     USDG  $0.99995
```

Contoh seed **0.25 saham**:

| Pair | Butuh saham | Butuh counter |
|---|---|---|
| AAPL/WETH | 0.25 AAPL | 0.038361 WETH |
| AAPL/USDG | 0.25 AAPL | 86.23 USDG |
| NVDA/WETH | 0.25 NVDA | 0.022832 WETH |
| NVDA/USDG | 0.25 NVDA | 51.32 USDG |
| TSLA/WETH | 0.25 TSLA | 0.044421 WETH |
| TSLA/USDG | 0.25 TSLA | 99.85 USDG |

Rasio seed sebaiknya mendekati harga pasar agar posisi tidak langsung keluar range.

## 4. Service fee — 49 USDG

Terverifikasi onchain: `serviceFee = 49000000` (49 USDG, 6 desimal), token USDG.

- Dibayar **terpisah** dari seed
- Langsung pindah ke service recipient di `BellPoolFactory.sol:160`
- Tidak ada fungsi refund di kontrak
- Kalau transaksi create revert, tidak ada yang terpotong (rollback penuh)

Contoh AAPL/USDG: seed 86.23 + fee 49 = **135.23 USDG**.

## 5. Ringkasan minimum

Satu pool AAPL/USDG dengan 0.25 AAPL:

```
Wallet 0x6C36…d399 :
  ETH   : 0.003        gas + cadangan
  AAPL  : 0.25         ~$86
  USDG  : 135.23       86.23 seed + 49 fee

Wallet 0x58Cd…a6fC :
  ETH   : 0.0005       untuk tarik fee
```

Karena fee 49 kembali ke wallet sendiri, biaya bersih pembuatan pool ≈ **gas saja**.

## 6. Pilih pool class dulu

| | PRICE_GUARDED | SESSION_ONLY |
|---|---|---|
| Butuh health report | Tidak (ada fallback) | Tidak |
| Butuh reference adapter | Ya — kelima adapter sedang hidup | Tidak |
| Peluang langsung aktif saat CLOSED | Tinggi | Bisa STAGED |
| Proteksi harga | Ada (fallback fee 1%, cap ketat) | Tidak ada |

Pasar sedang **CLOSED** sampai 2026-11-02 01:00 UTC.

## 7. Sebelum submit

- [ ] Deployer punya ETH ≥ 0.003
- [ ] Token seed sudah di wallet deployer, rasio mendekati harga pasar
- [ ] USDG ≥ seed USDG + 49
- [ ] Pool class sudah dipilih
- [ ] Wallet service recipient di-backup private key-nya

## 8. Yang tidak bisa diverifikasi dari repo

- Cara memperoleh token AAPL / NVDA / TSLA di Robinhood Chain
- Kepemilikan wallet `0x58Cd…a6fC` — EOA tidak bisa dibuktikan onchain
