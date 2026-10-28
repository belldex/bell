# BELL — kondisi aktual (trace 2026-10-28)

Dokumen ini satu sumber kebenaran. Isinya hanya yang bisa dibuktikan ulang: kode di tree, test
yang benar-benar dijalankan, dan state yang dibaca langsung dari chain 46630.

**Status: end-to-end sudah jalan di testnet.** Pool pertama hidup, swap pertama berhasil onchain.

---

## 1. Ringkasan

BELL sudah **beroperasi penuh di Robinhood Testnet (chainId 46630)**:

- Pool pertama dibuat dan di-seed lewat `BellPoolFactory.createAndSeed`.
- Hook `0x60ebf7082ea56a6956af5a137a2ae50937162cc0` aktif, `mode = ACTIVE`, `canSwap = true`.
- **Swap pertama berhasil**: 5 token0 → 3 token1, budget commit `[5, 3]`, rolling cap turun
  `[100, 100] → [95, 97]`. Hook benar-benar menegakkan policy di hot path.

Yang belum: PRICE_GUARDED (butuh referensi yang diadmit), Mainnet, dan frontend yang mengirim
transaksi.

---

## 2. Kontrak live (chain 46630)

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
| WETH (fixture) | `0x7bb4d894a9498c46abdb20e0adc6a08506d62fb9` |
| BellRouter | `0xf5427ca12727aa85e2659df939d16ef0862944c7` |
| mBELL fee token (6 desimal) | `0xe683f39fbaf9ced50c0ac2fd56c2032c58d82150` |
| AAPL Rehearsal Stock Token | `0x1d35a37f74a910ee181e6898034975ed384ff833` |
| YahooSourceVerifier | `0x20a066123c260bc6c5253f75e261c5056fde4bea` |
| Direct adapter (scope 0) | `0xfcbc049c4406d446112735b0bf2a9153500e6d2e` |
| Regular adapter (scope 1) | `0xba9b5142f282dde204805d66fddb5d6256080926` |
| Extended adapter (scope 2) | `0xe2380390ee342ad42dc463d6518f1e67cc5a52c3` |

Manifest hash: `0xcbdecf25eba7ec6df7787382e65779d49a651aee9a6ce698e62c2907fccb2179`.
Verifikasi: `check-testnet-addresses.mjs --rpc` → 11 alamat ber-kode, semua binding cocok.

---

## 3. Pool pertama

| Field | Nilai |
|---|---|
| Hook | `0x60ebf7082ea56a6956af5a137a2ae50937162cc0` |
| Pool ID | `0x01ca38d9ebfc30a7387a07f4b41d9b947ed3b520f78bb28690c17f82ddcdeaed` |
| Create tx | `0x7c1542eb6d7c7d0665ba520449e07fd0668c439a5e0f422fae8aba312a17c568` |
| Block | `143921854` |
| token0 | AAPL Rehearsal Stock Token |
| token1 | WETH fixture |
| Pool class | SESSION_ONLY |
| Liquidity mode | PUBLIC |
| tickSpacing | 60 |
| Lifecycle | 2 (LIVE) |
| Mode | 1 (ACTIVE) |

Bukti: `evidence/deploy/testnet-pool-created.json`.

---

## 4. Swap pertama (onchain)

| Field | Nilai |
|---|---|
| Swap tx | `0x75243421ed21adcd8e233e129bb0346cab0ea47af1c907e18c0e703117ecb830` |
| Block | `143926986` |
| Gas used | 680.432 |
| Executor | `0x7aaac503f38ab25a4a311b408d8820c7db2e8111` |
| Arah | token0 → token1 (`zeroForOne`) |
| Spent token0 | 5 |
| Received token1 | 3 |
| Hook `currentGross` setelah swap | `[5, 3]` |
| `rollingRemaining` setelah swap | `[95, 97]` |

Yang dibuktikan: `beforeSwap` mengembalikan fee override sesi, `afterSwap` memvalidasi delta aktual
dan menulis budget, dan policy benar-benar menolak kalau budget habis.

Bukti: `evidence/deploy/testnet-swap-executed.json`.

---

## 5. Kenapa ini butuh waktu (temuan teknis)

1. **EIP-170.** `BellHook` tadinya 24.571 byte dari batas 24.576 — sisa 5 byte. Glue swap inline
   jadi 30.128 byte. Solusinya: seluruh evaluasi policy pindah ke `BellPolicyOracle`
   (STATICCALL, tanpa tulis). Hook turun ke 23.842 (sisa 734), oracle 19.892.
2. **EIP-3860.** Oracle di-deploy sekali per deployment, bukan per hook, supaya initcode hook
   turun dari 63.221 ke 43.630 byte.
3. **`SourceWire` schema 12 ditolak codec.** Validator JS hanya menerima schema 11 padahal
   `AssetRegistry` menerima 11 dan 12. Diperbaiki.
4. **`queueRoot` ABI salah urutan field.** `CalendarRoot` menaruh `datasetHash` di akhir, bukan
   setelah `root`.
5. **`settle()` tanpa `sync()`** → `CurrencyNotSettled()`. PoolManager butuh `sync` sebelum
   transfer agar reserve terhitung.
6. **Recovery butuh 60 detik + observasi maju.** `activatePool` menolak pool yang `healthySince`
   belum lewat 60 detik, jadi skrip harus menerbitkan dua quote dengan jeda dan checkpoint di
   antaranya.
7. **Fixture test `_activate()` menulis `bellStart` ke slot salah.** Selama ini test "activated"
   sebenarnya tidak pernah aktif.

---

## 6. Test dan gate

`pnpm check` terakhir: **351 forge test** (27 suite, 2 invariant 100k run), **297 node:test**,
45+18 reference Python, 15 Deno, 6 keeper-b, compile 166 source, `abi:check`, `evidence:check`,
`check:secrets` — semua hijau.

Test baru yang penting: `testHealthySyntheticLiveAdvertisesExecutionAndPreparesSwap` — satu-satunya
test positif swap di repo sebelum ini.

---

## 7. Yang masih terbuka

| Hal | Kenapa |
|---|---|
| PRICE_GUARDED | `referenceMode` belum punya pemetaan numerik; tidak ada pasangan referensi yang diadmit |
| Mainnet | Belum ada transaksi di 4663; adapter Mainnet belum dideploy |
| Frontend kirim tx | Layar swap masih berhenti di "Review & simulate"; tidak ada `writeContract` |
| Keeper harga | Keeper masih no-op; sampel diperbarui manual lewat skrip |
| Token saham asli | API resmi Robinhood: 195 aset, semua hanya di 4663 |

---

## 8. Cara memverifikasi ulang

```bash
node scripts/deploy/check-testnet-addresses.mjs --rpc
node scripts/deploy/verify-testnet-deployment.mjs --check
pnpm check
```

Untuk melihat swap terakhir onchain:

```bash
node -e "const{createPublicClient,http,parseAbi}=require('viem');const c=createPublicClient({transport:http(process.env.RH_TESTNET_RPC_PRIMARY)});(async()=>{const a=parseAbi(['function buckets() view returns ((uint64,uint128[2],uint128[2]))']);console.log(await c.readContract({address:'0x60ebf7082ea56a6956af5a137a2ae50937162cc0',abi:a,functionName:'buckets'}))})()"
```
