# Dev Brief — BELL Opening Bell Auction (FINAL)

Nov 5, 2026 · @ronald
Status: **keputusan tertutup, siap masuk implementation plan**

Opening Bell Auction mengganti perilaku "swap pertama mengambil seluruh gap" saat bursa buka dengan **satu batch clearing di harga seragam**. Fitur ini butuh **hook template baru (v2)**, karena hook BELL yang sudah live immutable dan tidak bisa ditambah mode baru.

---

## 1. Masalah dan tujuan

**Masalah.** Saat sesi berpindah dari CLOSED ke sesi aktif, harga pool masih harga penutupan. Swap pertama setelah open mengeksekusi terhadap harga basi dan mengambil seluruh selisih. LP menanggung kerugiannya. Fee CLOSED dan closure budget membatasi kerugian selama pasar tutup, tapi tidak menyelesaikan gap di momen open.

**Tujuan v1:**

1. Semua order di jendela open dieksekusi di **satu clearing price** yang sama.
2. Tidak ada swap biasa ke pool selama jendela auction.
3. Invariant BELL tetap: **exit LP tidak pernah bisa diblokir**, hook immutable, fail-closed.
4. Dana pengguna di escrow selalu bisa ditarik kembali (cancel sebelum cutoff, atau refund permissionless setelah timeout).

**Di luar cakupan v1:** commit-reveal (sealed bids), auction di penutupan (closing cross), auction untuk halt intraday, auction harian OVERNIGHT→PRE, pool `PRICE_GUARDED`.

---

## 2. Keputusan final

Keputusan di bawah ini menutup seluruh pertanyaan terbuka pada draf sebelumnya.

| # | Keputusan | Alasan |
| --- | --- | --- |
| K-1 | **Jendela: CLOSED → open saja** (Senin dan setelah libur) | Sesi paling sedikit, nilai tertinggi, state paling mudah dinalar |
| K-2 | **Tanpa fee P2P** (`auctionFeeBps = 0`) | Residual sudah membayar fee pool ke LP. Menghapus akuntansi `donate` yang tidak perlu |
| K-3 | **Auction per pool** (bukan singleton) | Tanpa keying `poolId`, tiap auction self-contained, blast radius escrow kecil |
| K-4 | **Pool class: `SESSION_ONLY` saja** | Lihat §3. Menghapus seluruh ketergantungan feed |
| K-5 | **Clearing: solver offchain + verifikasi onchain** | Tidak ada pencarian/optimasi onchain; verifikasi O(n). Ini *mengurangi* scope, bukan menambah |
| K-6 | **`settle()` permissionless**, tanpa insentif keeper khusus | Liveness tidak bergantung pada satu keeper |
| K-7 | **`AUCTION` bukan `Mode`/`MarketPhase` baru** | Lihat §4. Enum, policy constants, ABI manifest, dan klien web tidak tersentuh |
| K-8 | **Tidak ada acuan harga eksternal** | Feed Chainlink segar hanya 1–6% waktu (§3) |

---

## 3. Mengapa `SESSION_ONLY`, dan mengapa tanpa acuan eksternal

`PRICE_GUARDED` mensyaratkan referensi segar. Data produksi menunjukkan itu **tidak bisa diandalkan**:

- Feed Robinhood Chain adalah **heartbeat/deviation**, bukan streaming: heartbeat **86.400 detik (24 jam)**, deviasi **0,5%**, satu proxy per saham.
- Audit 100 round per saham (`evidence/deploy/mainnet-4663-session-feed-history.json`): estimasi cakupan waktu "segar" di bawah gate 120 detik hanya **1–6%** per sesi. Gap terpanjang dalam satu sesi: **20.134 detik** (TSLA REGULAR).
- Read live 2026-11-05 02:25 UTC (sesi OVERNIGHT): AAPL 20.072s, NVDA 490s, TSLA 25s — semua terhadap limit 120 detik.
- Preseden kegagalan yang sama sudah terjadi: `captureClose` **tidak bisa membuat close anchor** karena round terakhir Jumat 15:51 ET sudah berjam-jam saat boundary 20:00 ET (`docs/CURRENT-STATE.md`). Dan sejak 2026-10-31, `PRICE_GUARDED` pun jatuh ke AMM-only fallback saat feed basi — artinya referensinya praktis tidak bekerja hampir sepanjang waktu.

**Kesimpulan:** apa pun yang di-gate pada "feed segar di momen X" akan gagal. Karena itu v1 tidak memakai acuan eksternal sama sekali. `P*` murni ditentukan order book + kurva pool.

**Konsekuensi yang diakui:** order book satu sisi membuat auction terdegenerasi menjadi satu swap ter-batch di harga pool (tidak lebih buruk dari hari ini, tapi juga tidak lebih baik). Manfaat auction sebanding dengan seberapa dua-sisi flow saat open. Ini properti desain yang didokumentasikan, bukan bug.

---

## 4. Model state

**`AUCTION` bukan state di `ModePolicy`/`MarketPhase`.** Itu state milik kontrak auction; hook hanya bertanya ke kontrak itu. Dengan begitu:

- `contracts/src/types/ProtocolTypes.sol` (enum `Mode`, `MarketPhase`) — **tidak berubah**.
- `PolicyConstants.sol`, `config/policy/policy-v1.json`, `abi-manifest.json` — **tidak berubah**.
- Pemetaan `phase` numerik di web (`apps/web/app/(app)/swap/page.tsx`) — **tidak rusak**.

State machine kontrak auction:

| Transisi | Pemicu | Perilaku |
| --- | --- | --- |
| `IDLE` → `OPEN` | `openTime - auctionLead` | Order masuk escrow lewat Permit2; swap biasa ke pool **revert** |
| `OPEN` → `LOCKED` | `openTime` | Order tidak bisa masuk atau dibatalkan |
| `LOCKED` → `SETTLED` | `settle()` valid | Fill dibagi di `P*`; residual dieksekusi ke pool; swap biasa dibuka |
| `LOCKED` → `REFUNDED` | `settle()` gagal/tidak dipanggil sampai `openTime + settleTimeout` | Semua order bisa diklaim penuh; **swap biasa dibuka kembali** |

Hook v2 memblokir `_beforeSwap` untuk semua sender kecuali kontrak auction **selama `OPEN` dan `LOCKED`**. State `REFUNDED` wajib membuka swap lagi (pool tidak boleh nge-brick).

---

## 5. Arsitektur

**Kontrak baru:**

- **`BellHookV2`** (template CREATE2 baru, flags tetap `0x2CC0`). Sama dengan `BellHook`, ditambah **dua hal saja**: `address public immutable auction` dan `address public immutable router`, plus guard di `_beforeSwap`.
  **Kenapa router ikut diperlukan:** pada `beforeSwap` v4, `sender` adalah pemanggil `PoolManager.swap`, yaitu **router** — bukan kontrak auction. Jadi `sender == auction` tidak pernah benar untuk swap residual. Guardnya harus membaca `payer` dari `hookData` router (`abi.encode(payer, requestHash, oracleUpdates)`) dan mensyaratkan **keduanya**: `sender == router && payer == auction`. `hookData` tidak bisa dipalsukan karena hanya router yang menyusunnya dari `msg.sender`-nya sendiri.
  `beforeAddLiquidity` menolak add selama `OPEN`/`LOCKED` untuk mencegah JIT liquidity menyerap residual. Permission tetap **tanpa** `beforeRemoveLiquidity` / `afterRemoveLiquidity` — exit LP tidak bisa diblokir di state mana pun.
- **`BellOpeningAuction`** — **satu kontrak per pool**. Menyimpan order di escrow (`{owner, side, amountIn, limitPrice}`), memverifikasi hasil clearing, mengeksekusi residual ke pool, dan mengelola refund.
- **`BellPoolFactoryV2`** — `createAndSeed` untuk hook v2, dan mendeploy satu `BellOpeningAuction` per pool.

**Kontrak yang dipakai ulang tanpa perubahan:** `CalendarRegistry`, `SessionRegistry`, `BellPolicyOracle`, `BellPolicyDependencyReader`, `AssetRegistry`, `SafetyController`, `BellRouter`, PoolManager/PositionManager/Permit2.

> Koreksi dari draf sebelumnya: `BellModeEvaluator` **tidak** perlu menyadari `AUCTION` (lihat §4). Ia tidak disentuh.

**Deployment:** memakai jalur yang sudah ada, `scripts/deploy/deploy-mainnet-factory-update.mjs`, yang mengganti hook template + factory sambil memakai ulang registries aktif.

**Pool lama tidak ter-upgrade.** Migrasi = LP menarik in-kind dari pool v1, lalu seed pool v2. Ini harus dikomunikasikan sejak teaser, termasuk biaya fee factory per pool.

---

## 6. Mekanisme clearing

**Order:** `{owner, side, amountIn, limitPrice}`. Dana ditarik ke escrow lewat Permit2 saat submit.

**Konvensi token.** Di kontrak auction, **`token0` = quote (USDG)** dan **`token1` = base (saham)**. Ini konvensi milik auction, **tidak harus sama** dengan urutan `token0`/`token1` pool v4 (pool TSLA/USDG punya `token0 = TSLA`). Adapter yang menerjemahkan arahnya.

**Algoritma (solver offchain, verifikasi onchain):**

1. Solver menghitung satu angka: **`P*`** (`clearingSqrtPriceX96`).
2. Solver mengirim `settle(P*)`. **Tidak ada `fills[]` dan tidak ada `residualAmount`** — kontrak menghitung keduanya sendiri, jadi solver tidak punya ruang untuk memilih siapa dibayar berapa.
3. Kontrak memverifikasi, semuanya O(n):
   - setiap order masih menerima `P*` sesuai limitnya: **buyer** (`zeroForOne = true`, membayar quote) butuh `P* ≤ limit`; **seller** butuh `P* ≥ limit`;
   - menghitung `demandBase` (dari order beli) dan `supplyBase` (dari order jual) memakai `AuctionClearing`;
   - residual = selisihnya; tolak kalau `> auctionResidualCap` (dalam satuan **base**).
4. Kontrak mengeksekusi residual sebagai **satu swap** ke pool. Kalau residual nol, tidak ada swap.
5. **Joint solve diverifikasi, bukan dicari:** harga marginal pool **wajib ≈ `P*`** dalam toleransi — **selalu**, termasuk saat residual nol. Tanpa cek tanpa syarat ini, solver bisa memilih `P*` sembarang di kasus buku yang saling menutup.
6. Payout dihitung dari identitas netting: **buyer menerima `baseForQuote(quote_i, P*)` base**, **seller menerima `quoteForBase(base_j, P*)` quote**. Escrow terbukti balans di kedua arah residual.
7. Order yang tidak ter-fill (mis. kena cap) di-refund.

**`auctionResidualCap`** adalah batas tersendiri, terpisah dari `tradeCap`/`windowCap` biasa, dan tetap masuk perhitungan flow budget pool. Nilainya diturunkan dari depth pool nyata (lihat §10) supaya cap tidak menutup residual yang justru dibutuhkan.

**Fee:** tidak ada fee auction. Residual membayar fee sesi normal pool ke LP. Bagian P2P tidak memungut fee (K-2).

**Gas:** verifikasi O(n) dengan `maxOrders` 25, jauh di bawah risiko kehabisan gas.

---

## 7. Keamanan dan failure mode

| Risiko | Mitigasi v1 |
| --- | --- |
| Dana terkunci di escrow | Cancel bebas sebelum cutoff; `claimRefund()` **permissionless** setelah `settleTimeout` |
| `settle()` tidak dipanggil | Permissionless + terverifikasi; keeper `bell-keeper-b` sebagai pemanggil default. Tidak ada insentif khusus di v1 |
| Refund diblokir pause | `cancel` dan `claimRefund` **di luar jalur `SafetyController`** — tidak bisa di-pause |
| Pool nge-brick setelah settle gagal | State `REFUNDED` **wajib** membuka swap biasa kembali |
| Manipulasi harga pool tepat sebelum auction | Swap biasa revert sejak `auctionLead`; residual dibatasi `auctionResidualCap` |
| JIT liquidity menyerap residual | `beforeAddLiquidity` menolak add selama `OPEN`/`LOCKED` |
| Solver nakal memilih `P*` | `limitPrice` tiap order mengikat batas terburuknya; konservasi + cek harga pasca-residual memverifikasi. Order tak ter-fill di-refund |
| Order spam / DoS | `maxOrders` 25 + `minOrderSize`; tolak saat penuh |
| Double settle / reentrancy | State machine satu arah per auction; CEI + reentrancy guard |
| Halt / pause di open | Sesi `HALTED` → auction tidak di-settle, refund dibuka |
| Gap aktivasi calendar | Auction fail-closed + reason bit eksplisit; keeper sudah punya repair calendar |
| Sniping di blok terakhir | Diterima di v1 (order publik); commit-reveal di v2. Sequencer Robinchain terpusat: didokumentasikan |
| Exit LP terblokir | Invariant: hook v2 tidak meminta permission remove-liquidity; test eksplisit di setiap state |

**Tambahkan ke `LossOfFundsIndex.t.sol`:** escrow drain, double settle, refund setelah settle parsial, residual melewati cap, JIT add saat auction, cancel setelah cutoff, harga basi di clearing, withdraw LP di setiap state auction, settle saat `HALTED`, dan settle dengan `P*` yang gagal cek harga pasca-residual.

**Catatan noncustodial (wajib ditindaklanjuti sebelum tayang).** Escrow memegang dana pengguna selama jendela auction. Klaim "smart contracts never hold custodial control over user funds" menjadi tidak akurat untuk dana escrow. Teks di `docs/bell_report.md` dan `docs/submission_package.txt` harus disempitkan menjadi: **noncustodial untuk posisi LP; escrow berkode dengan exit permissionless**. Halaman protocol menjelaskan escrow ini secara terbuka.

---

## 8. Frontend dan keeper

**Halaman `/auction` (atau panel di `/swap`):**

- Countdown ke cutoff dan ke open.
- Form order: sisi, jumlah, limit price, preview, simulasi `simulateContract`.
- **Indicative clearing price** read-only dari order yang sudah masuk (dihitung ulang, bukan janji).
- Daftar order milik wallet: cancel sebelum cutoff, claim setelah settle atau refund.
- Status jelas: `OPEN` · `LOCKED` · `SETTLED` · `REFUNDED`.

**Keeper (`bell-keeper-b`):** panggil `settle()` setelah `openTime`; publikasikan hasil auction di `/status`; sumber data untuk ritual post "The Bell" di X. Karena settle sekarang **tidak** bergantung pada feed segar, tidak ada balapan dengan gate 60 detik.

---

## 9. Parameter final per pool (masuk `configHash`, immutable)

| Parameter | Nilai v1 | Catatan |
| --- | --- | --- |
| `auctionLead` | 600 detik (10 menit) | Jendela order sebelum open |
| `settleTimeout` | 900 detik (15 menit) | Setelah ini refund dibuka tanpa syarat |
| `maxOrders` | 25 | Turun dari 100 (gas + anti-spam) |
| `minOrderSize` | diturunkan dari depth pool | Diisi saat create |
| `auctionResidualCap` | diturunkan dari depth pool | Diisi saat create, terpisah dari cap biasa |
| `auctionFeeBps` | 0 | K-2 |

---

## 10. Migrasi, deployment, dan gate eksternal

| Langkah | Status sekarang |
| --- | --- |
| Testnet 46630 | **HIDUP** (primary/secondary/archive semua jawab chainId 46630) — dipakai untuk seluruh pembangunan & uji |
| Kalender mainnet | Aktif sampai **~2026-12-30**; sebelum itu `queueRoot` perlu dijalankan |
| Deploy mainnet | **TERBLOKIR**: saldo deployer `0x6c36...` = **0,000001 ETH**; upgrade factory sebelumnya menghabiskan gasnya |
| Audit pihak ketiga | Gate eksternal (fokus escrow + clearing) |
| Migrasi pool | LP withdraw in-kind dari pool v1 → seed pool v2 → fee factory per pool |

---

## 11. Milestone dan exit criteria

| Fase | Isi | Exit criteria |
| --- | --- | --- |
| 0. Baseline | Ukur gap capture di pool v1: harga swap pertama setelah open vs harga feed (dipakai saat feed kebetulan segar) | Data 4–8 pembukaan |
| 1. Kontrak | `BellHookV2`, `BellOpeningAuction`, `BellPoolFactoryV2` | Semua test lama lulus + test baru lulus; invariant fuzzing exit LP tiap state; `LossOfFundsIndex` mencakup seluruh baris tabel §7 |
| 2. Frontend + keeper | `/auction`, `settle()` di keeper | Alur order/cancel/claim dan settle teruji di testnet |
| 3. Testnet | Deploy di 46630, auction nyata di beberapa pembukaan | **≥3 auction sukses**, **≥1 skenario REFUND teruji** |
| 4. Audit | Audit pihak ketiga fokus escrow dan clearing | Temuan high/critical ditutup |
| 5. Mainnet | Pool v2 untuk AAPL, NVDA, TSLA | **Menunggu gas deployer**; halaman protocol diperbarui, disclosure escrow tayang |

**Metrik keberhasilan:** selisih antara harga eksekusi pertama setelah open dan harga feed (target: mendekati nol di pool v2 dibanding baseline v1); kerugian LP per pembukaan; jumlah partisipan auction.
