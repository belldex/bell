# End-to-end testnet execution — bukti dan cara mengulang

Tanggal: 2026-10-28. Chain: Robinhood Testnet (46630).

Dokumen ini mencatat **apa yang benar-benar terjadi onchain**, bukan rencana.

---

## Hasil

| Tahap | Status | Bukti |
|---|---|---|
| Deploy stack 10 kontrak | ✅ | `evidence/deploy/testnet-46630.json`, 11 alamat ber-kode |
| Deploy stock token + 3 adapter Yahoo | ✅ | `evidence/deploy/testnet-stock-adapters.json` |
| Admit WETH + stock descriptor | ✅ | `evidence/deploy/testnet-46630-asset-queue.json` |
| Calendar root + interval | ✅ | interval aktif, phase REGULAR |
| Health ready, reasonBits 0 | ✅ | `SessionRegistry.health` = ready |
| Pool pertama create + seed | ✅ | tx `0x7c1542eb…` block `143921854` |
| **Swap pertama** | ✅ | tx `0x75243421…` block `143926986` |

---

## Urutan skrip (bisa diulang)

```bash
# 1. Deploy seluruh stack
node scripts/deploy/deploy-testnet.mjs

# 2. Deploy stock token dan adapter Yahoo yang terikat ke token itu
node scripts/deploy/deploy-testnet-stock-and-adapters.mjs

# 3. Admit WETH counterasset dan stock descriptor
node scripts/deploy/admit-testnet-assets.mjs

# 4. Calendar root + interval, publish quote, submit report, refresh health
node scripts/deploy/setup-calendar-and-price.mjs

# 5. Terbitkan quote baru dan segarkan health (dipakai juga oleh langkah 6)
node scripts/deploy/refresh-stock-health.mjs

# 6. Buat dan seed pool pertama
node scripts/deploy/create-testnet-pool.mjs

# 7. Jalankan swap onchain
node scripts/deploy/execute-testnet-swap.mjs
```

---

## Kendala nyata yang ditemukan saat menjalankan

Semuanya sudah diperbaiki di kode/script, dicatat supaya tidak terulang.

1. **`SourceWire` schema 12 ditolak codec JS.** Validator di `packages/protocol/src/source-codec.mjs`
   hanya menerima schema 11, padahal `AssetRegistry` menerima 11 dan 12. Akibatnya encoding
   `sourceConfig` untuk adapter Yahoo gagal sebelum dikirim.
2. **Urutan field `CalendarRoot` salah di ABI script.** Struct menaruh `datasetHash` di akhir, bukan
   setelah `root`. `queueRoot` revert sampai ABI diperbaiki dan dibaca langsung dari artifact.
3. **`settle()` tanpa `sync()` → `CurrencyNotSettled()`.** `PoolManager` menghitung reserve dari
   selisih saldo; tanpa `sync` sebelum transfer, settle gagal. `TestnetSwapExecutor` sekarang
   memanggil `sync` lebih dulu.
4. **`activatePool` butuh `healthySince` berumur ≥ 60 detik.** Pool tidak bisa langsung aktif hanya
   dengan satu quote. Skrip menerbitkan dua quote berjeda, checkpoint `refreshState` di antaranya,
   lalu menunggu 65 detik sebelum recovery selesai.
5. **`ModePolicy` menahan pool di RECOVERING selama candidate berjalan.** `refreshState` harus
   dipanggil dua kali: sekali untuk memulai candidate, sekali untuk menyelesaikannya setelah
   observasi maju dan 60 detik terlewati.
6. **`BellHook` hanya 5 byte di bawah EIP-170.** Glue swap inline jadi 30.128 byte. Solusi:
   evaluasi policy pindah ke `BellPolicyOracle` lewat STATICCALL. Hook 23.842 byte, oracle 19.892.
7. **Initcode hook 63.221 byte melewati EIP-3860.** Oracle di-deploy sekali per deployment, bukan
   per hook. Initcode turun ke 43.630.

---

## Yang dibuktikan swap pertama

- `beforeSwap` mengembalikan `lpFeeUnits | OVERRIDE_FEE_FLAG`, jadi fee mengikuti sesi (REGULAR),
  bukan fee statis.
- `afterSwap` memvalidasi delta aktual dari core, bukan angka dari user.
- Budget benar-benar ditulis: `currentGross` `[0,0] → [5,3]`, `rollingRemaining` `[100,100] → [95,97]`.
- Hook menolak swap saat policy tidak sehat — dibuktikan berkali-kali selama persiapan ketika
  `canSwap` masih `false` dan transaksi tidak bisa disiapkan.

---

## Batas yang tetap berlaku

- Hanya **SESSION_ONLY**. `PRICE_GUARDED` ditolak dengan `PRICE_INPUT_INVALID_OR_STALE` karena
  belum ada pasangan referensi yang diadmit dan `referenceMode` belum punya pemetaan numerik.
- Token saham di testnet adalah **rehearsal token**, bukan Robinhood Stock Token resmi. API resmi
  mencantumkan 195 aset, semuanya hanya di chainId 4663.
- Belum ada transaksi Mainnet.
- Frontend belum mengirim transaksi; keeper harga masih no-op.
