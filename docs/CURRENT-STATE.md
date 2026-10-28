# BELL — kondisi aktual (trace 2026-10-28, pembaruan keeper + frontend)

Satu sumber kebenaran. Semua klaim punya transaksi atau state onchain.

**BELL sekarang benar-benar beroperasi di testnet: pool hidup terus, swap sudah 3x, frontend punya
jalur kirim transaksi nyata.**

---

## 1. Ringkasan

- **Keeper harga aktif.** `scripts/deploy/keeper-price.mjs --loop` menjaga health dan hook state.
  Terbukti: `canSwap` `false → true` dalam 2 tick, lalu stabil `true` 45+ menit tanpa campur tangan.
- **Tiga swap live onchain**, semua dengan budget commit yang tercatat (tabel di bawah).
- **Frontend punya jalur swap nyata** (`LiveSwapPanel`): baca policy onchain, approve, kirim ke
  `BellRouter`, tampilkan hasilnya. Muncul hanya jika `NEXT_PUBLIC_BELL_LIVE_HOOK` diisi.
- 355 forge test, 298 node:test, semua gate hijau.

Yang masih tertutup: Mainnet (butuh dana), PRICE_GUARDED (butuh referensi yang diadmit), treasury
handover (alamat masih burn address), dan keeper belum dipasang di Supabase cron.

---

## 2. Tiga swap live

| # | Tx | Block | Spent | Received | Gross sebelum | Gross sesudah |
|---|---|---|---|---|---|---|
| 1 | `0x75243421…` | 143926986 | 5 | 3 | `[0, 0]` | `[5, 3]` |
| 2 | `0x1692a6e8…` | 143938679 | 7 | 5 | `[5, 3]` | `[7, 5]` |
| 3 | `0x9c846c76…` | 143938848 | 9 | 7 | `[7, 5]` | `[9, 7]`, prev `[7, 5]` |

Swap ketiga membuktikan **rolling window benar-benar berotasi**: `previousGross` sekarang berisi
`[7, 5]`, bukan nol. Semua swap dikonfirmasi lewat `eth_getTransactionReceipt` dengan `status: success`.

---

## 3. Keeper harga

```bash
# mode rehearsal offline (tanpa Yahoo)
node scripts/deploy/keeper-price.mjs --offline --price=250

# mode broadcast satu tick
node scripts/deploy/keeper-price.mjs --offline --price=250 --broadcast

# mode jalan terus
node scripts/deploy/keeper-price.mjs --offline --price=250 --broadcast --loop --interval=30
```

Tanpa `--broadcast`, keeper hanya mencetak apa yang akan dilakukan — tidak ada transaksi.

Perilaku penting:
- **Market Yahoo tutup itu kondisi normal**, bukan crash. Dilaporkan sebagai `STALE_SOURCE`, tidak
  ada yang ditandai fresh, tidak ada yang dianggap sehat.
- `--offline` menjaga pool tetap hidup untuk rehearsal ketika market tutup.
- Setiap tick menulis `evidence/runtime/keeper-price-last.json` supaya monitor cukup membaca satu
  file kecil, bukan membaca chain.

Log nyata dari sesi ini:

```
02:51:59  canSwap=false
02:52:32  canSwap=false   (recovery 60 detik masih berjalan)
02:52:59  canSwap=true    <- pool hidup
02:53:37  canSwap=true
02:54:10  canSwap=true
02:54:42  canSwap=true
... stabil lebih dari 45 menit
```

---

## 4. Frontend swap nyata

`apps/web/components/swap/LiveSwapPanel.tsx` + `apps/web/lib/live-swap.ts`.

Yang dilakukan:
1. `readLivePool(hook)` → baca `poolKey`, `configHash`, `getPolicy()` langsung dari chain.
2. Jika `canSwap === false`, tampilkan "not currently tradable" dan **tidak membangun transaksi**.
   Keputusan ada di kontrak, bukan di UI.
3. Approve terpisah dan terlihat.
4. `buildSwapRequest` menerapkan slippage ke `limitAmount` (exact-input melindungi output floor).
5. Kirim ke `BellRouter.swap`, tunggu receipt, cek status onchain.
6. Revert dipetakan ke pesan yang bisa ditindaklanjuti: `PolicyBlocked`, `SlippageExceeded`,
   `DeadlineExpired`, penolakan wallet, dana kurang.

Panel muncul hanya jika `NEXT_PUBLIC_BELL_LIVE_HOOK` diisi, jadi mode preview tidak berubah.

Guard test baru (`apps/web/test/homepage.test.mjs`) memastikan:
- `functionName: 'swap'` dan `functionName: 'approve'` benar-benar ada di jalur live;
- `readLivePool` dipanggil (policy dibaca onchain, bukan dari fixture);
- panel gate pada `pool.canSwap`, bukan mengarang sukses.

---

## 5. Alamat kontrak (chain 46630)

| Kontrak | Alamat |
|---|---|
| SafetyController | `0x47ac35f7edbc35b7e03c7c069e45a8f8113b7ee5` |
| AssetRegistry | `0x4d477a439b127fcac45bbbbd535ba9b0d0345488` |
| CalendarRegistry | `0xc59abadcb3c46d20a9638d986d5bfb5f59247cbd` |
| SessionRegistry | `0xc54eb072f6322c0b7d869123bf226564cf302fdf` |
| PoolManager | `0x4ddb8673ad90d4d3508c61531a981bc1f22a850b` |
| PositionManager | `0xd7b88b6769b0a1aab9a63089bf6a01fa3dc6e254` |
| BellHookDeployer | `0xbc985ec03935363d755506eed26fbd13c6a3c577` |
| BellPoolFactory | `0xbf77c974a61d0ee270a468ffcf49dfcb3fb3a86c` |
| WETH fixture | `0x7bb4d894a9498c46abdb20e0adc6a08506d62fb9` |
| BellRouter | `0xf5427ca12727aa85e2659df939d16ef0862944c7` |
| mBELL fee token | `0xe683f39fbaf9ced50c0ac2fd56c2032c58d82150` |
| AAPL rehearsal stock | `0x1d35a37f74a910ee181e6898034975ed384ff833` |
| Yahoo verifier | `0x20a066123c260bc6c5253f75e261c5056fde4bea` |
| Direct adapter | `0xfcbc049c4406d446112735b0bf2a9153500e6d2e` |
| Regular adapter | `0xba9b5142f282dde204805d66fddb5d6256080926` |
| Extended adapter | `0xe2380390ee342ad42dc463d6518f1e67cc5a52c3` |
| **Hook pool pertama** | `0x60ebf7082ea56a6956af5a137a2ae50937162cc0` |

---

## 6. Cara menjalankan ulang seluruh alur

```bash
# deploy stack
node scripts/deploy/deploy-testnet.mjs
node scripts/deploy/deploy-testnet-stock-and-adapters.mjs
node scripts/deploy/admit-testnet-assets.mjs
node scripts/deploy/setup-calendar-and-price.mjs

# buat pool
node scripts/deploy/create-testnet-pool.mjs

# nyalakan keeper (biarkan jalan)
node scripts/deploy/keeper-price.mjs --offline --price=250 --broadcast --loop --interval=30

# swap kapan saja selama keeper jalan
node scripts/deploy/swap-live-pool.mjs --amount=-5
```

---

## 7. Test

355 forge test (28 suite, 2 invariant 100k run), 298 node:test, 45+18 reference, 15 Deno,
6 keeper-b, compile 169 source, `abi:check`, `evidence:check`, `check:secrets` — semua hijau.
Web: typecheck bersih, build 7 route, test web 6/6.

---

## 8. Yang tersisa, jujur

| Hal | Kenapa |
|---|---|
| Mainnet | Butuh ETH asli dan keputusan pendanaan |
| PRICE_GUARDED | Butuh pasangan referensi yang diadmit + pemetaan `referenceMode` |
| Treasury handover | Treasury masih `0x…dEaD`, butuh alamat pengganti |
| Keeper di Supabase cron | Sekarang proses lokal; belum dipasang ke pg_cron |
| Data hak Yahoo | Masih `NOT_VERIFIED` di `config/sources/rights-status.json` |
