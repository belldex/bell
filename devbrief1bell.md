# Dev Brief — BELL Opening Bell Auction (FINAL)

Nov 5, 2026 · @ronald
Status: **final setelah review mekanisme Uniswap v4**

Opening Bell Auction memberi order beli dan jual yang memenuhi limit kesempatan untuk match dalam **satu batch pada harga seragam** saat sesi dibuka. Fitur ini butuh **hook template baru (v2)**, karena hook BELL yang sudah live immutable dan tidak bisa ditambah mode baru. Auction P2P ini tidak mengubah harga AMM; order satu sisi atau yang tidak match direfund.

---

## 1. Masalah dan tujuan

**Konteks.** Saat sesi berpindah dari CLOSED ke sesi aktif, harga pool masih harga penutupan. Swap biasa dapat bergerak dari harga itu mengikuti likuiditas AMM. Auction ini memberi peserta cara untuk mencocokkan order pada satu harga sebelum swap biasa dibuka lagi. Karena tidak ada AMM residual atau acuan eksternal, auction tidak menjamin harga pool menyamai harga pasar dan tidak menjamin order satu sisi akan terisi.

**Tujuan v1:**

1. Semua order yang cocok di jendela open dieksekusi di **satu clearing price** yang sama.
2. Tidak ada swap biasa ke pool selama jendela auction.
3. Invariant BELL tetap: **exit LP tidak pernah bisa diblokir**, hook immutable, fail-closed.
4. Dana pengguna di escrow selalu bisa ditarik kembali (cancel sebelum cutoff, atau refund permissionless setelah timeout).

**Di luar cakupan v1:** commit-reveal (sealed bids), auction di penutupan (closing cross), auction untuk halt intraday, auction harian OVERNIGHT→PRE, pool `PRICE_GUARDED`, residual AMM.

---

## 2. Keputusan final

Keputusan di bawah ini menutup seluruh pertanyaan terbuka pada draf sebelumnya.

| # | Keputusan | Alasan |
| --- | --- | --- |
| K-1 | **Setiap transisi kalender CLOSED → PRE atau CLOSED → OVERNIGHT** | Didefinisikan dari leaf CalendarRegistry, termasuk Senin/libur dan Sunday 20:00 ET |
| K-2 | **Tanpa fee P2P** (`auctionFeeBps = 0`) | V1 tidak memanggil AMM atau donate; tak ada fee pool yang harus dibagi |
| K-3 | **Auction per pool** (bukan singleton) | Tanpa keying `poolId`, tiap auction self-contained, blast radius escrow kecil |
| K-4 | **Pool class: `SESSION_ONLY` saja** | Lihat §3. Menghapus seluruh ketergantungan feed |
| K-5 | **P2P-only uniform-price; tanpa AMM residual atau solver tepercaya** | AMM fee + price impact berarti residual tidak dieksekusi pada P*. Maksimum 25 order membuat pencarian kandidat P* onchain terbatas |
| K-5a | **Kontrak memilih P* volume-maksimum dari limit order; tie → harga terendah** | Deterministik; keeper tak mengirim harga atau alokasi payout |
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

**Kesimpulan:** apa pun yang di-gate pada "feed segar di momen X" akan gagal. Karena itu v1 tidak memakai acuan eksternal sama sekali. `P*` ditentukan oleh order book; pool curve tidak dilibatkan dalam clearing P2P.

**Konsekuensi yang diakui:** auction hanya mengeksekusi volume dua sisi yang cocok. Jika order book satu sisi atau tidak ada pasangan yang memenuhi limit, semua order yang tidak match direfund dan pool dibuka kembali. Tidak ada AMM residual dan tidak ada janji order satu sisi akan dieksekusi. Ini disengaja agar semua fill yang terjadi benar-benar di satu harga dan tak menghabiskan LP liquidity.

---

## 4. Model state

**`AUCTION` bukan state di `ModePolicy`/`MarketPhase`.** Itu state milik kontrak auction; hook hanya bertanya ke kontrak itu. Dengan begitu:

- `contracts/src/types/ProtocolTypes.sol` (enum `Mode`, `MarketPhase`) — **tidak berubah**.
- `PolicyConstants.sol`, `config/policy/policy-v1.json`, `abi-manifest.json` — **tidak berubah**.
- Pemetaan `phase` numerik di web (`apps/web/app/(app)/swap/page.tsx`) — **tidak rusak**.

Satu auction per pool melayani semua cycle open. **Jangan** menyimpan `openTime` tetap saat pembuatan pool: `nextInterval` saat itu dapat menunjuk REGULAR/POST hari yang sama, bukan pembukaan setelah CLOSED. Keeper memanggil `armNext()` permissionless pada auction; kontrak sendiri membaca `currentInterval(assetId)` dan `nextInterval(assetId)` dari `CalendarRegistry`, lalu hanya menerima jika current leaf adalah CLOSED yang masih aktif, next leaf bersebelahan dan berada dalam root ter-commit, serta next phase adalah PRE atau OVERNIGHT. `openTime` diambil dari `next.start`; kontrak menyimpan hash kedua leaf dan menaikkan `cycleId`. `armNext()` idempotent selama cycle sama. Order dan klaim diisolasi per `cycleId`, sehingga order cycle lama tak mengisi slot cycle baru. Jika current leaf bukan CLOSED atau tak ada next leaf valid, fungsi no-op/revert tanpa mengubah state.

State machine per cycle:

| Transisi | Pemicu | Perilaku |
| --- | --- | --- |
| `IDLE` → `ARMED` | `armNext()` setelah kalender membuktikan CLOSED→PRE/OVERNIGHT | Simpan `openTime`, kedua leaf hash, dan `cycleId` |
| `ARMED` → `OPEN` | `openTime - auctionLead` | Order masuk escrow; swap biasa ke pool **revert** |
| `OPEN` → `LOCKED` | `openTime` | Order baru/cancel ditutup |
| `LOCKED` → `SETTLED` | `settle()` menghitung clearing maksimum-volume | Match dibayar di P*; sisanya refundable; swap biasa dibuka |
| `LOCKED` → `REFUNDED` | `openTime + settleTimeout` tanpa settlement | Semua order cycle dapat direfund; **swap biasa dibuka kembali** |

Hook v2 memblokir `_beforeSwap` untuk semua sender selama `OPEN` dan `LOCKED`; auction P2P tidak memanggil PoolManager. State `SETTLED` dan `REFUNDED` membuka swap kembali. `beforeAddLiquidity` menolak add selama `OPEN`/`LOCKED`; remove-liquidity tetap tidak diblokir.

---

## 5. Arsitektur

**Kontrak baru:**

- **`BellHookV2`** (template CREATE2 baru, flags tetap `0x2CC0`). Guard `_beforeSwap` menolak semua swap biasa selama `OPEN`/`LOCKED`; tidak ada caller auction yang dibolehkan swap residual. `beforeAddLiquidity` menolak add selama jendela tersebut. Permission remove-liquidity tidak dipasang, sehingga LP exit tetap bebas.
- **`BellOpeningAuction`** — **satu kontrak per pool**. Escrow order, memilih/memverifikasi clearing price maksimum-volume, menghitung fill P2P secara deterministik, membayar hasil match, dan membuka klaim refund untuk bagian tak match.
- Batas v1: maksimal **512 cycles per pool**; sebelum batas ini tercapai, LP migrasi ke pool generation baru. Batas eksplisit mencegah lifecycle/storage tumbuh tanpa batas di satu auction immutable.
- `BellRouterResidualAdapter` tidak digunakan untuk v1 P2P-only dan tidak dibuat/didaftarkan oleh factory.
- **`BellAuctionFactoryModule`** — dideploy sekali per protocol generation dan dipanggil atomic oleh `BellPoolFactory.createAndSeed`; membuat satu `BellOpeningAuction` reusable per pool. Module dipisah dari factory agar runtime factory tetap di bawah EIP-170.

**Kontrak yang dipakai ulang tanpa perubahan:** `CalendarRegistry`, `SessionRegistry`, `BellPolicyOracle`, `BellPolicyDependencyReader`, `AssetRegistry`, `SafetyController`, `BellRouter`, PoolManager/PositionManager/Permit2.

> Koreksi dari draf sebelumnya: `BellModeEvaluator` **tidak** perlu menyadari `AUCTION` (lihat §4). Ia tidak disentuh.

**Deployment:** `BellAuctionRegistry` ditulis sekali oleh factory untuk menunjuk ke `BellAuctionFactoryModule`; module membuat satu auction per pool. Auction menyimpan `CalendarRegistry` + `assetId` dan memvalidasi transisi kalender saat `armNext()`. Factory tidak membaca atau mengunci `openTime` saat create. Upgrade script membuat registry → module → V2 hook deployer → factory dengan CREATE addresses yang diprediksi; manifest dan Worker vars menyimpan registry/module address.

**Pool lama tidak ter-upgrade.** Migrasi = LP menarik in-kind dari pool v1, lalu seed pool v2. Ini harus dikomunikasikan sejak teaser, termasuk biaya fee factory per pool.

---

## 6. Mekanisme clearing

**Order:** `{cycleId, owner, side, amountIn, limitPriceX96}`. Dana ditarik ke escrow memakai ERC-20 allowance saat submit; Permit2 bukan dependency v1.

**Konvensi token.** Auction menyebut `quoteToken` = USDG dan `baseToken` = saham. Itu semantik aplikasi, bukan urutan currency v4. `P*` didefinisikan sebagai quote raw units per base raw unit, direpresentasikan sebagai `quotePerBaseX96`; jangan dibandingkan langsung dengan `PoolManager.slot0.sqrtPriceX96`.

**Algoritma (clearing sepenuhnya onchain, `maxOrders=25`):**

1. `limitPriceX96` adalah quote-token raw units per base-token raw unit, dikali `2^96`; ini **bukan** `sqrtPriceX96` v4. Limit nol ditolak. Semua hitungan quote/base memakai `FullMath.mulDiv` dan arah pembulatan dinyatakan di bawah.
2. Keeper memanggil `settle(cycleId)` tanpa mengirim P*, fills, atau payout.
3. Kontrak membentuk maksimum 25 kandidat unik dari limit order cycle itu. Untuk tiap kandidat, hitung demand base dari buyer yang limit ≥ kandidat dan supply base dari seller yang limit ≤ kandidat.
4. Pilih kandidat yang memaksimalkan `min(demandBase, supplyBase)`; jika seri, pilih harga terendah.
5. Alokasi memakai price priority lalu FIFO order ID: buyer dengan cap tertinggi dan seller dengan floor terendah dipenuhi lebih dulu. Fill tiap order dibatasi escrow-nya. Untuk setiap buyer, quote debit = `ceil(baseFill * P* / 2^96)`, sehingga buyer tidak pernah membayar kurang dari limit-price math.
6. Total quote seller terima **persis** total quote buyer debit. Bagi quote ke seller proporsional pada base fill dengan `floor`; sisa raw quote units dibagi satu per satu berdasarkan FIFO seller ID. Escrow surplus dari pembulatan buyer menjadi quote refund pemilik buyer; jika liability quote melebihi saldo escrow, settle revert sebelum menulis payout.
7. Tidak ada AMM residual atau `PoolManager.swap`. Bagian order tak match/tak terisi diklaim melalui `claimUnfilled(cycleId, orderId)`. Volume match nol tetap menutup cycle tanpa fill; semua escrow refundable.

`auctionResidualCap` dihapus di v1: tidak ada residual swap ke pool.

**Fee:** tidak ada fee auction (`auctionFeeBps = 0`). P2P settlement tidak memanggil pool, tidak membayar fee AMM, dan tidak memotong LP liquidity.

**Gas:** pemindaian kandidat O(n²), dibatasi `maxOrders=25`. Ukur gas pada 25 limit unik sebagai acceptance gate sebelum testnet.

---

## 7. Keamanan dan failure mode

| Risiko | Mitigasi v1 |
| --- | --- |
| Dana terkunci di escrow | Cancel bebas sebelum cutoff; `claimRefund()` **permissionless** setelah `settleTimeout` |
| `settle()` tidak dipanggil | Permissionless + terverifikasi; keeper `bell-keeper-b` sebagai pemanggil default. Tidak ada insentif khusus di v1 |
| Refund diblokir pause | `cancel` dan `claimRefund` **di luar jalur `SafetyController`** — tidak bisa di-pause |
| Pool nge-brick setelah settle gagal | State `REFUNDED` **wajib** membuka swap biasa kembali |
| Manipulasi harga pool tepat sebelum auction | Pool spot bukan input P*; P* berasal dari limit order dan settlement P2P |
| JIT liquidity selama auction | `beforeAddLiquidity` menolak add selama `OPEN`/`LOCKED`; remove-liquidity tetap bebas |
| Solver nakal memilih `P*` | Kontrak mengevaluasi kandidat limit, mengecek maksimum volume, dan memakai tie-break deterministik |
| Order spam / DoS | `maxOrders` 25 + `minOrderSize`; tolak saat penuh |
| Double settle / reentrancy | State machine satu arah per auction; CEI + reentrancy guard |
| Halt / pause di open | `settle()` cek status policy; jika HALTED, settlement ditolak dan refund tetap tersedia |
| Gap aktivasi calendar | Auction fail-closed + reason bit eksplisit; keeper sudah punya repair calendar |
| Sniping di blok terakhir | Diterima di v1 (order publik); commit-reveal di v2. Sequencer Robinchain terpusat: didokumentasikan |
| Exit LP terblokir | Invariant: hook v2 tidak meminta permission remove-liquidity; test eksplisit di setiap state |

**Tambahkan ke `LossOfFundsIndex.t.sol`:** escrow drain, double settle, refund setelah settlement, incorrect maximum-volume P*, quote/base rounding imbalance, JIT add saat auction, cancel setelah cutoff, withdraw LP di setiap state auction, dan settlement saat `HALTED`.

**Catatan noncustodial (wajib ditindaklanjuti sebelum tayang).** Escrow memegang dana pengguna selama jendela auction. Klaim "smart contracts never hold custodial control over user funds" menjadi tidak akurat untuk dana escrow. Teks di `docs/bell_report.md` dan `docs/submission_package.txt` harus disempitkan menjadi: **noncustodial untuk posisi LP; escrow berkode dengan exit permissionless**. Halaman protocol menjelaskan escrow ini secara terbuka.

---

## 8. Frontend dan keeper

**Halaman `/auction` (atau panel di `/swap`):**

- Countdown ke cutoff dan ke open.
- Form order: sisi, jumlah, limit price, preview, simulasi `simulateContract`.
- **Indicative clearing price** read-only dari order yang sudah masuk (dihitung ulang, bukan janji).
- Daftar order milik wallet: cancel sebelum cutoff, claim setelah settle atau refund.
- Status jelas: `OPEN` · `LOCKED` · `SETTLED` · `REFUNDED`.

**Keeper (`bell-keeper-b`):** tiap cron menit, panggil `refund()` untuk cycle expired yang belum difinalkan, lalu `armNext()` (kontrak fail-closed memeriksa leaf). Saat LOCKED, panggil `settle()` tanpa harga input. Settlement tidak bergantung pada feed segar; publikasi cycle/result/failed-settlement ke `/status` dan jadi sumber data post "The Bell" di X.

---

## 9. Parameter final per pool (masuk `configHash`, immutable)

| Parameter | Nilai v1 | Catatan |
| --- | --- | --- |
| `auctionLead` | 600 detik (10 menit) | Jendela order sebelum open |
| `settleTimeout` | 900 detik (15 menit) | Setelah ini refund dibuka tanpa syarat |
| `maxOrders` | 25 | Turun dari 100 (gas + anti-spam) |
| `minOrderSize` | 1% dari principal quote/base yang benar-benar di-seed (floor, minimum 1 raw unit) | Diisi saat create oleh factory module |
| `maximumCycles` | 512 per immutable auction | Generasi pool baru sebelum batas habis |
| `auctionResidualCap` | tidak ada | Tidak ada AMM residual pada v1 |
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
