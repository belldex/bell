# BELL — kondisi aktual (trace 2026-10-27)

Dokumen ini menggantikan narasi status yang tersebar di ledger dan runbook. Isinya **hanya**
yang bisa dibuktikan ulang: kode yang ada di tree, test yang benar-benar dijalankan, dan state
yang dibaca langsung dari chain 46630 pada block yang dicatat. Kalau sesuatu tidak diverifikasi,
ditulis "belum diverifikasi", bukan "selesai".

Trace dijalankan ulang pada 2026-10-27 17:0x lokal; head testnet saat pembacaan `143532008`.

---

## 1. Ringkasan satu paragraf

Protokolnya lengkap secara kode dan lulus seluruh suite (351 forge, 298 node, 45+18 reference,
15 Deno, 6 keeper-b), dan satu stack rehearsal 10-kontrak hidup di Robinhood testnet 46630 dengan
wiring yang terverifikasi onchain. Jalur harga sekarang **Yahoo + reporter EIP-712 BELL**; Chainlink
Data Streams sudah ditinggalkan karena berbayar. **Swap enforcement sudah aktif** untuk pool
SESSION_ONLY sejak M05-05 selesai: `BellHook` benar-benar menyiapkan dan menyelesaikan swap. Yang
belum ada: **deskriptor saham**, **calendar root**, **quote yang masih segar**, dan karena itu
**pool pertama**. Jadi belum ada satu swap pun yang pernah terjadi di chain.

---

## 2. Perubahan arah yang belum tercatat di dokumen lama

Ini sumber utama kenapa dokumen lama menyesatkan.

| Hal | Dokumen lama bilang | Kondisi sekarang |
|---|---|---|
| Sumber harga | Chainlink Data Streams, butuh entitlement per API key | **Yahoo Finance chart + reporter EIP-712 BELL**. Chainlink ditinggalkan (berbayar). |
| Trust boundary | Verifier proxy Chainlink `0xcE73…36E7` | `YahooSourceVerifier` milik BELL, reporter key terpisah dari governance |
| Audit | Independent security review (M14-03) wajib | Diputuskan **tidak pakai audit independen**; diganti audit internal by code. Gate E01–E06 tetap harus jujur, tidak boleh di-pass palsu |
| Harga saham Mainnet | Belum ada jalur | Ada, tapi adapter Mainnet **belum dideploy**; script preflight masih placeholder |

Dokumen `docs/runbooks/data-rights.md` masih menulis "Chainlink Data Streams (sumber harga
eksekusi)". Itu sudah tidak benar dan sudah diperbaiki di commit yang sama dengan dokumen ini.

---

## 3. Yang benar-benar hidup onchain (chain 46630)

Semua alamat di bawah dibaca ulang: `eth_getCode` non-kosong, dan untuk yang punya binding,
getter-nya dibandingkan dengan manifest.

### 3.1 Stack rehearsal inti — 10 kontrak, manifest `0x2ca2ec5a…`

| Kontrak | Alamat | Code bytes |
|---|---|---|
| SafetyController | `0xcb4a1d33ec49c47e93216481702dc55815de3181` | 5059 |
| AssetRegistry | `0x3432c77f580fe822edef62381441de15a5ba3a0c` | 12255 |
| CalendarRegistry | `0x54072fc3c79d1c2778b9065373b20b5dcd6866d0` | 10475 |
| SessionRegistry | `0x86cc0993d50f918674a648bb9aa37938034dad7e` | 18013 |
| PoolManager | `0xb1d808d93dc18aa83cb83b46d08fce7522d7ba35` | 19725 |
| PositionManager | `0x53b2d214d9a46f2d2d7a7349395fdd43e1af72f6` | 20664 |
| BellHookDeployer | `0x4e048280f6a5eada5d7b35e49276934426c71049` | 3015 |
| BellPoolFactory | `0x9d36ecf35310cb03d1f1d622306963fbedb9efe6` | 16877 |
| WETH (fixture) | `0x254e506ee8a9f1f8128d36106f240c5d41b9d8be` | 3254 |
| BellRouter | `0x35ce0b38a70c7d3df0d3a33fba2dfdd900298741` | 7502 |
| mBELL fee token (fixture, 6 desimal) | `0xe683f39fbaf9ced50c0ac2fd56c2032c58d82150` | 1820 |

Deploy: 10 tx, block `142881475`–`142881484`, gas 36.115.743 @ 10 gwei, sourceCommit `ee407db`.

### 3.2 Jalur harga Yahoo — 6 kontrak tambahan

| Kontrak | Alamat | Peran |
|---|---|---|
| YahooSourceVerifier | `0x20a066123c260bc6c5253f75e261c5056fde4bea` | verifier EIP-712, chainId 46630 |
| YahooAttestedSourceAdapter (direct) | `0xdcc4fa3e0fa29361616799a891cc1dd2eaf61806` | scope 0, kind 1, harga token ter-adjust |
| YahooAttestedSourceAdapter (regular) | `0x00a7e4845a25cbed8f15510d4b2ead9ec37c0ccd` | scope 1, schema 12 |
| YahooAttestedSourceAdapter (extended) | `0x71ed9d187628fbd2bbd7f7c9d8aeb80b1b12f03c` | scope 2 (PRE/POST) |
| YahooAttestedSourceAdapter (overnight) | `0x86da1e4a1b2a20321ad7cd9eec5b99061ba4ccf6` | scope 3 |
| AaplTestnetFacade | `0x64a82eb01d7c7310ef1bc5f0055f758409d45c63` | **bukan** token canonical; hanya memenuhi cek `stockToken.code.length` |

Reporter: `0x6C8bAF28eA08DD00A1A64EE350167A70A7b3E98a` (EOA, key terpisah dari governance).

### 3.3 Wiring yang lulus pemeriksaan

15 binding dibaca dan cocok dengan manifest: `router.poolManager`, `router.canonicalWeth`,
`positionManager.{poolManager,WETH9,permit2}`, `poolFactory.{hookDeployer,positionManager,serviceToken}`,
`hookDeployer.{factory,sessionRegistry}`, `sessionRegistry.{assetRegistry,calendarRegistry}`,
`assetRegistry.safetyController`, `calendarRegistry.safetyController`, `poolManager.owner`.

Nilai lain yang terbaca: `factory.liquidityMode = 0` (PUBLIC saja), `factory.serviceFee = 49000000`,
`weth.symbol = WETH`, `weth.decimals = 18`, `feeToken.decimals = 6`,
`poolManager.owner = 0x6C36…d399` (masih deployer).

---

## 4. Yang **tidak** hidup, dan ini yang penting

### 4.1 Swap enforcement sudah aktif untuk SESSION_ONLY

`contracts/src/BellHook.sol` → `SWAP_EXECUTION_READY = true`. `_beforeSwap` menyiapkan snapshot dan
mengembalikan `lpFeeUnits | OVERRIDE_FEE_FLAG`; `_afterSwap` menyelesaikan delta aktual dan menulis
`_buckets` serta `_episodeGross` hanya saat pool CLOSED.

Ini bisa dilakukan karena evaluasi policy dipindah ke `BellPolicyOracle` (STATICCALL, tanpa tulis,
tanpa otorisasi). Hook turun dari 24.571 byte (sisa 5 byte) ke 23.842 byte (sisa 734), sehingga glue
swap muat. Detail: `docs/M05-05-swap-execution.md`.

Batasnya jujur: hanya `SESSION_ONLY`. `PRICE_GUARDED` tetap ditolak dengan
`PRICE_INPUT_INVALID_OR_STALE` karena belum ada pasangan referensi yang diadmit dan `referenceMode`
belum punya pemetaan numerik.

Dan tetap: **belum ada swap nyata di testnet**, karena belum ada pool. Untuk itu masih perlu
deskriptor saham + calendar root.

### 4.2 Tidak ada deskriptor saham

`descriptorIdForToken` mengembalikan nol untuk facade AAPL dan untuk mBELL. Yang ACTIVE hanya WETH:

- `descriptorId = 0x88cb2233…6287`, `isStock = false`, `capabilityMask = 0`, semua adapter nol,
  `sourceConfig` kosong. Queue tx `0xdf3e6f6b…`, aktivasi tx `0x2c91a85a…` (block `142929063`).

Artinya `BellPoolFactory._admitted` belum bisa lolos: dia butuh satu sisi saham dengan
`SessionRegistry.health()` `ready`, `reasonBits == 0`, dan `validUntil > now`.

### 4.3 Tidak ada calendar root

`CalendarRegistry.currentInterval(WETH)` = semua nol (`session=0`, `startAt=0`, `endAt=0`,
`leafHash=0x0`). `rootCount` bahkan tidak ada di ABI kontrak ini; root di-queue per aset lewat
`queueRoot`. Tanpa interval, `refreshHealth` untuk saham tidak akan pernah hijau.

### 4.4 Quote terakhir sudah kedaluwarsa

Sample direct terakhir di adapter:

| Field | Nilai |
|---|---|
| `price18` | `342944023940939432439` (≈ $342,94) |
| `observedAt` | `1793089910` |
| umur saat dibaca | **5500 detik** |
| `validUntil` | `1793090030` → sudah lewat 5380 detik |

Jadi klaim "first live publish sukses" itu benar sebagai peristiwa historis, tapi **tidak** berarti
ada harga yang valid sekarang. Policy BELL menolak observasi > 120 detik, dan sample ini 45× lipat
di luar itu. Ketiga adapter stream juga tidak punya sample sama sekali: `readCurrent()` revert
`WrongAdapterMode()` (`0x9c37e570`) karena mode-nya stream, bukan direct.

### 4.5 `health` belum pernah di-refresh

`SessionRegistry.health(WETH)` = `ready=false`, `reasonBits=0`, `validUntil=0`, `refreshedAt=0`.
Belum pernah ada pemanggilan `refreshHealth` yang berhasil.

### 4.6 Role treasury masih burn address

`SafetyController.treasury = 0x000000000000000000000000000000000000dEaD`.
`readTestnetStatus` menandai ini `UNUSABLE_ROLE_ADDRESS`. Artinya exit/treasury dan handover belum
mungkin direhearsal, dan UI testnet memang menampilkannya sebagai masalah.

---

## 5. Test dan build — hasil run terakhir

`pnpm check` dijalankan penuh pada 2026-10-27 dan hijau:

| Tahap | Hasil |
|---|---|
| `node:test` (domain, protocol, discovery, evidence, tooling, deploy, web) | **298 pass / 0 fail** |
| Reference Python (`engineering_checks.py` + `infra_spec_checks.py`) | **45 + 18 pass** |
| `forge test` | **351 pass / 0 fail**, 27 suite, 188 s |
| Deno smoke | **15 pass / 0 fail** |
| keeper-b (vitest) | **6 pass / 0 fail**, 3 file |
| `wrangler deploy --dry-run` | OK, 60,36 KiB / 13,77 KiB gzip |
| `abi:check`, `evidence:check`, `check:secrets` | OK |

Dua suite invariant ikut jalan di dalam 351 itu dan masing-masing 100.000 run:
`TreasuryAdapterInvariants` dan `BellHookClosureStatefulInvariants`.

Yang **tidak** dicakup suite ini: browser E2E (`test:e2e` masih `blocked-command`), fork test
berautentikasi (`test:fork` masih `blocked-command`), dan invariant swap produksi — karena swap
produksinya sendiri belum ada.

### 5.1 Test yang tadinya tidak pernah dijalankan — dan ternyata basi

`apps/web/test/homepage.test.mjs` ada di tree tapi tidak pernah masuk `test:unit`, jadi tidak
seorang pun tahu isinya sudah salah. Begitu dimasukkan ke gate, **dua dari tiga test langsung
gagal**: dia menuntut `.bar-track`, `.tcard`, dan `.cases` di CSS, padahal ketiga kelas itu tidak
ada lagi di `globals.css` (sekarang `.bell-marquee-track`, `.bell-story-card`, `.bell-wall`).

Itu contoh paling jelas dari masalah yang diminta diperbaiki: test yang tidak pernah jalan lebih
buruk daripada tidak ada test, karena dia memberi kesan ada jaminan.

Test-nya ditulis ulang supaya menegaskan hal yang benar-benar penting dan benar-benar ada:

- setiap section yang dirender `page.tsx` punya aturan CSS-nya;
- marquee tetap 22 detik linear dan berhenti saat `prefers-reduced-motion`;
- hero tetap menyatakan "Rehearsal build" dan "Production swaps are not enabled";
- salinan pemasaran tidak boleh lagi bilang "Nothing is deployed yet" (lihat §6.5);
- direktori pool tidak boleh menyiratkan fixture preview bisa swap.

Dua suite baru juga ditambahkan: `scripts/deploy/verify-testnet-deployment.test.mjs` (6 test) dan
`scripts/deploy/mainnet-yahoo-preflight.test.mjs` (3 test). Yang kedua mengunci supaya alamat
placeholder tidak pernah kembali ke preflight Mainnet.

Angka `298` di tabel atas adalah hasil `node --test` langsung setelah semua itu masuk: 280 test lama
+ 6 web (setelah ditulis ulang) + 6 verifikasi deploy + 3 preflight + 3 dari `solidity-compile.test`
yang memang sudah ada.

---

## 6. Cacat dokumentasi yang ditemukan dan sudah diperbaiki

Ini bagian yang menjawab "docs sudah tidak relevan".

### 6.1 `evidence/deploy/testnet-46630-verification.json` menunjuk deployment yang salah

Ini yang paling parah: **kesepuluh alamatnya** milik deployment lama, dan `manifestHash`-nya
`0xc66be27e…` sementara manifest sekarang `0x2ca2ec5a…`. Guard `check-testnet-addresses.mjs` gagal
dengan 11 error drift. Kalau ada yang percaya file ini, dia akan mengira stack yang hidup adalah
yang lain.

Diperbaiki bukan dengan mengetik ulang angkanya, tapi dengan script baru
`scripts/deploy/verify-testnet-deployment.mjs` yang menurunkan seluruh isi file dari chain +
manifest, dan punya mode `--check` yang exit 1 kalau evidence sudah basi. Sekarang:

```
node scripts/deploy/check-testnet-addresses.mjs --rpc
OK   manifest chainId 46630, 10 contracts, hash 0x2ca2ec5aa5b2903a...
OK   verification sourceCommit ee407db, manifestHash matches
OK   on-chain code verified for 11 addresses
```

### 6.2 `evidence/task-status.json` memakai hash brief yang sudah usang

Ledger menyimpan `briefSha256 = 623326e2…`, sedangkan file brief sebenarnya `2e7dbe11…`
(itu juga yang tertulis di `config/release-baseline.json`). Ledger-nya tidak pernah di-sync ulang
setelah brief berubah. `sync-task-status.mjs` mengambil hash dari baseline, jadi cukup dijalankan
ulang — dan `evidence:check` sekarang ikut memvalidasi field ini supaya tidak bisa diam-diam
menyimpang lagi.

### 6.3 `evidence/release-index.json` adalah duplikat mati yang isinya salah

Brief §1500 mewajibkan satu release evidence index dengan field `buildCommit`, `chainId`,
`artifactHashes`, `sourceManifestHash`, `planSnapshot`, `rpcPreflight`, `capacityTrace`,
`backupRestore`, `failoverDrills`, `evmResults`, `auditRetest`, `roles`, `costClassification`,
`reviewedBy`, `gateStatus`. File `evidence/release-index.json` memenuhi bentuk itu, tapi:

- `planSnapshot` masih hash lama (`623326e2…` / `0debb71f…`)
- `evmResults` masih `316 forge / 243 node` — sekarang 351 / 280
- `sourceStatus.accountAccess = VERIFIED_ACCESS` itu klaim era Chainlink yang tidak berlaku lagi
- tidak ada satu pun script yang membacanya, jadi tidak ada yang menangkap kebusukannya

File yang benar-benar divalidasi `check-release.mjs` justru `evidence/releases/index.json`, yang
skemanya beda dan isinya memang sudah benar (hash cocok baseline, gate `NOT_RUN`, tanpa klaim
berlebihan) — tapi dia tidak memuat field yang diwajibkan Brief. Jadi keduanya dibiarkan ada dengan
peran berbeda: `releases/index.json` yang divalidasi mesin, `release-index.json` yang deskriptif.
Sekarang keduanya divalidasi, sehingga yang deskriptif tidak bisa lagi membusuk tanpa ketahuan.

### 6.4 `mainnet-yahoo-preflight.mjs` memakai alamat adapter placeholder

Baris 15–17 memakai `0x…a001` sampai `0x…c004` untuk adapter Mainnet yang **belum pernah
dideploy**. Script-nya tidak akan lolos karena `preflightYahooMainnet` memanggil `getBytecode` dan
melempar `YAHOO_ADAPTER_NOT_DEPLOYED` — tapi kegagalannya terjadi jauh di dalam, setelah membaca
RPC Mainnet, dan pesan errornya tidak menyebut bahwa alamatnya placeholder. Sekarang gagal di
awal dengan pesan eksplisit.

### 6.5 Copy landing page menyatakan "Nothing is deployed yet"

`apps/web/components/landing/Promises.tsx` baris 19 berbunyi "Preview data here is not live pool
state. Nothing is deployed yet." Itu sudah tidak benar sejak 10 kontrak plus verifier dan empat
adapter Yahoo hidup di 46630. Kalimatnya diganti jadi menyebut kontrak memang ter-deploy untuk
rehearsal, tapi belum ada pool dan swap produksi belum aktif.

Direktori pool juga menulis "{n} of 9 sample pools can currently swap" — padahal tidak ada satu pun
pool onchain, jadi angka itu murni fiksi dari fixture. Sekarang berbunyi bahwa kesembilan pool itu
fixture preview dan tidak ada yang bisa swap.

---

## 7. Kenapa dokumen lama terasa "tidak update"

Tiga sebab, semuanya struktural, bukan kelalaian sekali jalan:

1. **Status ditulis sebagai narasi, bukan turunan.** `task-status.json` punya 80 task dengan field
   `status`/`evidence`/`blockers` yang diisi manual. Tidak ada yang memaksa nilainya cocok dengan
   kode. Task M05-05 misalnya tetap `BLOCKED_DEPENDENCY` padahal blocker-nya sudah 6 butir dan
   sebagian sudah tidak relevan.
2. **Alamat disimpan di empat tempat.** Manifest, file verification, `packages/protocol/src/testnet-status.mjs`,
   dan runbook. Guard drift baru menangkap tiga yang pertama; runbook tidak dijaga apa pun.
3. **Pivot Chainlink → Yahoo tidak pernah ditulis balik.** Enam task (M01-01..05, M14-02) masih
   menyebut Chainlink sebagai jalur, dan `data-rights.md` masih menyebut Chainlink sebagai sumber
   harga eksekusi.
4. **Ada test yang tidak pernah masuk gate.** `apps/web/test/homepage.test.mjs` duduk di tree
   tanpa pernah dijalankan, dan begitu dijalankan ternyata menuntut kelas CSS yang sudah tidak ada.

Perbaikannya ada di commit ini: script verifikasi yang menurunkan angka dari chain, hash brief yang
di-sync dari baseline, validasi tambahan di `check-release.mjs`, test web yang masuk gate, dan
dokumen ini sebagai satu sumber kebenaran.

Yang **tidak** diperbaiki, dan perlu keputusan pemilik: field `status` di `task-status.json` masih
diisi manual. Tidak ada cara mekanis untuk membuktikan M05-05 "belum selesai" selain membaca kode —
dan memang begitu seharusnya, karena status task adalah penilaian, bukan pengukuran.

---

## 8. Yang masih terbuka, diurutkan menurut apa yang membuka paling banyak sekaligus

### 8.1 M05-05 — swap enforcement (SELESAI untuk SESSION_ONLY)

Sudah dikerjakan. Evaluasi policy pindah ke `BellPolicyOracle`, hook turun ke 23.842 byte, dan
`_beforeSwap`/`_afterSwap` benar-benar menyiapkan serta menyelesaikan swap. Ada test positif yang
membuktikannya: `testHealthySyntheticLiveAdvertisesExecutionAndPreparesSwap`.

Sisa yang eksplisit di luar cakupan:

- `PRICE_GUARDED` belum bisa eksekusi (tidak ada referensi yang diadmit).
- Belum ada swap onchain karena belum ada pool.
- Belum ada benchmark gas hot-path terhadap target rilis.

### 8.1b Yang membuka paling banyak sekarang: pool pertama

Karena swap sudah bisa, penghalang utama bergeser ke **tidak adanya pool**. Untuk itu perlu tiga hal
sekaligus: deskriptor saham admitted, calendar root committed, dan sampel sumber yang masih segar.

### 8.2 M00-02 — compatibility set

Kemampuan EVM/Cancun Robinhood chain dan kompatibilitas fork belum diverifikasi, dan test
PositionManager public LP belum dijalankan di target chain. Ini yang menahan M13-03 (fork
integration) tetap `NOT_STARTED`.

### 8.3 Sumber dan calendar (M01, M03-05)

Yahoo menyelesaikan soal "ada harga segar tanpa biaya", tapi dua hal tetap kosong:

- **Hak data** — `config/sources/rights-status.json` masih `BLOCKED_ACCESS` dengan
  `reportEntitlementA/B = NOT_VERIFIED` dan `rawReportRedistribution = NOT_ALLOWED`.
- **Jadwal bursa nyata** — holiday, early close, dan timezone DB belum disumber, jadi
  `CalendarRegistry` belum punya isi yang bisa dipakai.

### 8.4 Token saham di testnet

API resmi Robinhood mengembalikan 195 aset, semuanya hanya di chainId 4663. Tidak ada AAPL/TSLA/NVDA
resmi di 46630. `AaplTestnetFacade` ada semata-mata supaya konstruktor adapter lolos cek kode; dia
bukan token canonical dan tidak boleh disebut sebagai saham.

### 8.5 Mainnet

Belum ada satu transaksi Mainnet pun. Adapter Mainnet belum dideploy, preflight-nya masih
placeholder (lihat §6.4), dan `config/release-baseline.json` menahan `mainnetFundingAllowed` dan
`publicReleaseAllowed` di `false` dengan E01–E06 semuanya `NOT_RUN`.

---

## 9. Cara memverifikasi ulang dokumen ini

```bash
# state onchain: alamat, ukuran kode, semua binding
node scripts/deploy/check-testnet-addresses.mjs --rpc

# evidence deploy masih cocok dengan chain? (exit 1 kalau basi)
node scripts/deploy/verify-testnet-deployment.mjs --check

# suite penuh
pnpm check
```

Kalau salah satu dari tiga itu gagal, dokumen ini yang salah, bukan perintahnya.
