# BELL — kondisi aktual (trace 2026-10-28, PRE rehearsal on Robinhood testnet)

Satu sumber kebenaran. Semua klaim punya transaksi atau state onchain.

**Pool rehearsal PRE terbaru dibuat, menerima satu swap, dan lulus acceptance 82/82 pada block
144183010.** Harga berasal dari Yahoo PRE melalui extended adapter; asset/token adalah fixture
rehearsal, bukan token Robinhood resmi. Ini snapshot testnet, bukan klaim kesehatan berkelanjutan.
Deployment sebelumnya dicatat terpisah.

---

## 1. Ringkasan

- **Yahoo PRE rehearsal terverifikasi** melalui direct + extended reports yang cocok dengan fase calendar PRE.
- **Satu swap testnet pada pool PRE terbaru**, dengan budget commit tercatat (tabel di bawah).
- **Acceptance fase PRE lulus 82/82** pada block 144183010; ini pemeriksaan satu snapshot, bukan klaim pool terus sehat.
- **Frontend punya jalur swap nyata** (`LiveSwapPanel`): baca policy onchain, approve, kirim ke
  `BellRouter`, tampilkan hasilnya. Muncul hanya jika `NEXT_PUBLIC_BELL_LIVE_HOOK` diisi.
- 355 forge test, 298 node:test, semua gate hijau.

Yang masih tertutup: Mainnet (butuh dana), PRICE_GUARDED (butuh referensi yang diadmit), treasury
handover (alamat masih burn address), dan keeper belum dipasang di Supabase cron.

---

## 2. Swap testnet

| Pool/deployment | Tx | Block | Spent | Received | Gross sebelum | Gross sesudah |
|---|---|---|---|---|---|---|
| Latest PRE rehearsal pool `0xa18cd3ff…` / hook `0xcE7f7306…` | `0x62b6060e…` | 144182744 | 5 | 3 | `[0, 0]` | `[5, 3]` |
| Previous REGULAR rehearsal pool `0xc2b56af3…` / hook `0x549f0C66…` | `0xca40693c…` | 144051118 | 5 | 3 | `[0, 0]` | `[5, 3]` |
| Previous pool `0x01ca38d9…` / hook `0x60ebf708…` | `0x75243421…`, `0x1692a6e8…`, `0x9c846c76…` | 143926986–143938848 | 5, 7, 9 | 3, 5, 7 | tracked separately | rolling window rotated |

Swap deployment terbaru dikonfirmasi receipt sukses dan gross `[5,3]`. Bukti pool terdahulu membuktikan
rotasi rolling window pada deployment lama; itu bukan bukti rotasi untuk pool terbaru.

Swap pool PRE terbaru dikirim saat policy onchain `canSwap=true`, `reasonBits=0`; tx sukses dan
gross berubah dari `[0,0]` menjadi `[5,3]`. Acceptance PRE lulus sesudahnya. Health/policy bersifat
time-sensitive dan dapat kedaluwarsa setelah keeper berhenti; jangan menyimpulkan pool tetap dapat
ditradingkan dari snapshot tersebut. Pool lama tetap REGULAR-only; PRE tidak pernah dilabel ulang.

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

Keeper memilih wire dari fase calendar onchain: REGULAR memakai regular adapter, PRE/POST memakai
extended adapter, dan overnight memakai overnight adapter. Yahoo PRE diterima hanya saat calendar
fase PRE; phase mismatch dan quote basi tetap ditolak. Gunakan `--gas=900000` jika RPC menolak
estimasi gas report dengan batas allowance.

```
06:58:30  canSwap=false   (recovery pending)
06:58:48  canSwap=true
06:59:05  canSwap=true
06:59:23  canSwap=true
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
| SafetyController | `0xcc73fc8265630a7b7873028f77584037273d70c2` |
| AssetRegistry | `0x3b71543bd71b9d4c9678216d338611236a37b380` |
| CalendarRegistry | `0x0c7a4044f2caf793b2062920c12baf8b33641e9c` |
| SessionRegistry | `0x1de6199618ddb2b5fdb869113e4b906628db168e` |
| PoolManager | `0xc353daf2a37aca96ea468239d973a76020dea059` |
| PositionManager | `0x9116ff2aa7a41b60b478ae3ecd8b9b0466a97874` |
| BellHookDeployer | `0xff8734ef77284d61e11a27146e939bc0bd8bf10a` |
| BellPoolFactory | `0x4b22251105e65d76366d27099ac7c5097b63faf5` |
| WETH fixture | `0x45b4bf15c1cb91442a62620441dbc0b6486dfebe` |
| BellRouter | `0x1b91eadba66747430188672bd7bce0cc3eef6c85` |
| mBELL fee token | `0xe683f39fbaf9ced50c0ac2fd56c2032c58d82150` |
| AAPL rehearsal stock (previous pool) | `0xb82815f01a3c9034fbf06d05a99f0beb862d705a` |
| AAPL rehearsal stock (latest PRE pool) | `0x3c2470c719522a44ade6a9c1f4fdf653e1d3295a` |
| Yahoo verifier | `0x20a066123c260bc6c5253f75e261c5056fde4bea` |
| Direct adapter | `0x8fb74c552f6e4fb5c9d2d943b446ff8e36c125f0` |
| Regular adapter | `0xc8f49f566a7a7aa16516e0ba1dc953a1b80bf1c6` |
| Extended adapter | `0x412bba02dda6160bca4ebe60abd0fee3cc3d9c4a` |
| **Latest PRE rehearsal pool hook** | `0xce7f73065907ea42ea8d0f0b389fa0d4b82dacc0` |
| **Latest PRE rehearsal pool ID** | `0xa18cd3ffdd044195a3985ade3a3330c40de6bd0353373a4c5ac6e74dfae7a82c` |
| Previous REGULAR rehearsal pool hook | `0x549f0c6657d9e39a034f7524e501d218b2c6acc0` |
| Previous REGULAR rehearsal pool ID | `0xc2b56af343d2bcf1d9729517223fed8b6c2ec16f748e25a2d281c21c49e2e0ea` |
| **Latest rehearsal stock** | `0x3c2470c719522a44ade6a9c1f4fdf653e1d3295a` |

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
