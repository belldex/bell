# Status Brief 1, 2 dan 3

Dicatat 25 November 2026 (UTC). Angka berasal dari verifier di repo (`scripts/einstein/verify-einstein-pool.mjs`, `verify-einstein-ant.mjs`) yang dijalankan terhadap RPC arsip mainnet 4663. Kalau ada angka di sini yang beda dengan halaman live, halaman live yang benar.

Legenda: PASS = terbukti on-chain dan diputar ulang. PARTIAL = sebagian terbukti. PENDING = belum dibuktikan. Tidak ada FAIL.

## Brief 1: Einstein Hooks v2 dan pool NVDA/USDG

Hasil verifier (27 November 2026, dari klon bersih repo publik): 17 PASS, 1 PARTIAL, 0 PENDING, 0 FAIL.

| Klaim | Status | Catatan |
| --- | --- | --- |
| P1 Kode sama dengan yang diklaim | PARTIAL | Sourcify: 1 dari 16 kontrak exact, 15 lainnya match. Build tanpa metadata hash, jadi exact butuh rebuild dan redeploy. Pemilik memilih membiarkan match. |
| P2 Tidak bisa diubah belakangan | PASS | Slot EIP-1967 nol di 15 kontrak dan hook pool. |
| P3 Izin hook sesuai | PASS | Hook mask 0x2cc0, bit remove-liquidity mati. |
| P4 Pool nyata dan berlikuiditas | PASS | Dibuat dan di-seed dalam satu tx, blok 114372026. |
| P5 Kalender ditandatangani post-quantum | PASS | Tiga panggilan governance (ECDSA dan SHRINCS). |
| P6 Fee sesi berlaku | PASS | Swap nyata di CLOSED, OVERNIGHT, PRE, REGULAR, POST. |
| P7 Auction jalan dengan order nyata | PASS | Cycle 3, 27 Nov 01:00 UTC: order beli dan order jual dari dua wallet berbeda masuk di jendela order, cycle ditutup di satu harga clearing dengan 0,00012 NVDA matched (tx settle 0x4c2ea135…9f90). Dikirim dan di-settle dengan tangan karena run CI tidak mengirim order tepat waktu. |
| P8 Selalu bisa keluar | PASS | Exit saat CLOSED dan saat pause, tanpa hook dan tanpa tanda tangan PQ. |
| P9 Kegagalan aman | PASS | N1 sampai N7 semuanya revert dengan error bernama. |
| P10 Biaya verifikasi PQ | PASS | 323.735 gas lawan 70.433 (sekitar 4,6 kali). |
| P11 Siapa pun bisa cek | PASS | Verifier jalan dari klon dangkal baru di commit 0437672 dengan hanya viem terpasang: P2 sampai P9 semuanya PASS. |
| N6 | PASS | Swap biasa di dalam jendela order auction revert dengan AuctionActive (tx 0x27c3d74a…35c5, blok 123874976). |

Yang masih terbuka di Brief 1: hanya P1 (Sourcify exact), keputusan pemilik untuk membiarkan match. Kalender AAPL dan TSLA di stack lama tidak diperpanjang otomatis.

## Brief 2: Einstein v3 Evolve (ekonomi LP, NVDA/USDG)

Status: belum jalan di mainnet. Metode sudah di-commit (`docs/einstein-v3-evolve-method.md`, `evidence/einstein/v3-evolve/method.json`).

| Run | Status |
| --- | --- |
| Run 1, 20 sampai 23 Nov | Tidak dimulai. Pool tidak didanai tepat waktu, tidak ada yang di-seed dan tidak ada yang diukur. Ditandai postponed. |
| Run 2, Thanksgiving 25 sampai 30 Nov | Tidak dimulai (diputuskan 25 Nov): tidak ada modal yang didanai, jadi tidak ada yang di-seed dan diukur. Ditandai postponed di halaman. Jendela baru ditetapkan sebelum pool di-seed, dan metode di-commit dulu. |
| Run 3, testnet 21 sampai 23 Nov | Selesai (final). Menguji mekanisme dengan token uji dan feed harga fixture, bukan ekonomi mainnet. |

Kebutuhan modal dihitung (26 Nov, `scripts/einstein/v3-evolve/mainnet-capital.mjs`, hanya baca): sisi kontrol butuh sekitar 1,78 USD (0,889 USDG dan 0,00547 NVDA, likuiditas dan tick sama dengan pool BELL). Pool BELL baru membayar service fee factory 49 USDG, jadi dua pool sekitar 52,6 USD, belum termasuk inventori bot dan gas. Memakai pool NVDA yang sudah ada sebagai sisi BELL menghindari fee itu, tapi mengubah aturan seed di blok yang sama, jadi metodenya harus diubah dan di-commit sebelum run.

Yang menahan: keputusan modal. Dua pool (BELL dan kontrol tanpa hook) harus di-seed dengan jumlah USD yang sama dan range yang sama. Tidak ada klaim dari Brief 2 yang bisa dibuat sebelum itu.

## Brief 3: ANT/USDG dan Einstein Hooks v3

Hasil replay: 13 PASS, 2 PARTIAL, 1 PENDING. Pool 0x4a956b0c5cd1c87f7480d652099a2f346667b7d978b6d8d6441a1c39664e5940, hook 0x5839006Fdb458b81e50d9d393A775c1B5F406cc0, dibuat di blok 121908958 dengan seed 4,8 USDG.

| Klaim | Status | Catatan |
| --- | --- | --- |
| A1, A2, A3, A4, A6 | PASS | Token ANT Robinhood, kalender PQ, pool dibuat, hook, swap di atas cap revert TradeCapExceeded. |
| M1, M2 | PASS | Admisi di AssetRegistry dan root kalender aktif. |
| V1, V2, V3, V4, V6 | PASS | Halt hybrid, resume dan auction (AuctionActive), halt tanpa tanda tangan PQ revert, halt yang lapse sendiri, exit saat HALTED. |
| A5 Fee tiap sesi | PASS | Lima sesi tercatat di mainnet dan fee dibaca dari event Swap: OVERNIGHT 5000, PRE 3000, REGULAR 500 (tx 0x4c2d07b3b3b228bbe605a593d6b740312aadbf85f8f6fc2d907c58aa473dcba7), POST 3000 (tx 0x4025f59eebbdab5453506e7d393e6527c30754f4a9d0de3e0dba12eb8c41b87a), CLOSED 10000 (tx 0x743de4650f9a674f992b05eaa01053ed8879d5a9170dce0055c3d6971b276af2). |
| A7, V7 Sourcify | PARTIAL | Match, bukan exact. Pemilik memilih membiarkan. |
| V5 Swap di jendela earnings | PENDING | Butuh tanggal earnings sungguhan dan root kalender berikutnya. Root sekarang berlaku sampai 1 Jan 2027 dan registry menolak root yang tumpang tindih. Kodenya sudah dibuat dan diuji. |
| B1 | Blocker | Chainlink tidak punya feed ANT. Harga di-attest BELL lewat kunci delegate. Ini asumsi kepercayaan dan tertulis di halaman. |

A5 selesai pada 26 Nov 01:31 UTC lewat workflow `ant-session-chain`. Catatan swap CLOSED: pool memakai closing anchor untuk harga, tetapi ANT tidak punya feed on-chain, sehingga registry menolak swap tanpa laporan harga (revert `ContextMismatch`). Swap CLOSED karena itu membawa satu laporan harga yang ditandatangani kunci delegate lewat adapter OVERNIGHT, dan fee 10000 pips tetap dikenakan sebagai sesi CLOSED. Worker tidak menandatangani untuk CLOSED, jadi rantai swap memakai kunci delegate dari GitHub secret untuk swap itu.

Catatan kejadian: swap REGULAR dan POST tanggal 24 Nov terlewat. Rantai swap berhenti dua kali karena dompet gas Worker kosong, sehingga Worker tidak mengaktifkan interval kalender dan menolak update harga. Dompet diisi 0,0005 ETH (tx 0x793c97662bf5647d905204fad7b22b412f6d33caf0d1e37e4ce3e3f3c4ce01be) dan rantai sekarang mencoba ulang error yang muncul sebelum swap terkirim.

## Insiden kunci REPORTER, 25 November

Perpanjangan delegate harga jam 00:46 UTC menandatangani dengan leaf 12 dari kunci REPORTER pasca-kuantum, lalu transaksinya gagal terkirim karena dompet pengirim kosong. Signer di CI maju ke leaf 13 sementara `PQKeyRegistry` masih menunggu leaf 12 dan tidak punya cara melompat. Perpanjangan berikutnya gagal ("signer at leaf 13, chain expects 12"), dan delegate harga ANT hampir habis.

Pemulihan: rotasi kunci lewat `HybridAuth.rotateRoleKey`, yang harus ditandatangani REPORTER sendiri di leaf yang dikenal rantai. Skrip `scripts/einstein/rotate-reporter-key.mjs` (workflow `reporter-key-rotation`) menandatangani digest rotasi di leaf 12 satu kali, hanya setelah memastikan signer lokal tepat satu leaf di depan rantai, kunci ECDSA cocok, dan simulasi mainnet lolos. Ini satu-satunya pemakaian ulang leaf yang disengaja, dan leaf 12 langsung terpakai oleh rotasi itu. Tanda tangan lama di leaf 12 tidak pernah masuk rantai, tapi calldata-nya sempat tercetak di log publik run yang gagal.

Hasil: tx `0xa9f8a61cc96b6aa58064f9f294265881f1854949bc03b8ff6d8f3286ca0667e7`, kunci REPORTER versi 2, leaf kembali ke 1, budget 4096. Status lama disimpan sebagai `reporter-retired-v1` di branch `pq-state`. Perpanjangan delegate berikutnya berhasil dengan leaf 1 sampai 4, delegate valid 25 jam. Verifier Brief 1 (13 PASS, 2 PARTIAL, 3 PENDING) dan Brief 3 (12 PASS, 3 PARTIAL, 1 PENDING) tidak berubah.

Pencegahan: perpanjangan sekarang mengecek saldo pengirim sebelum memakai leaf (commit `42a2dc4`).

## Infrastruktur

- Situs: Cloudflare Pages (project `bell-web`), apex dan `www` lewat nameserver Cloudflare. Deploy otomatis dari GitHub Actions (`pages-deploy`) saat file situs berubah, ditambah rantai swap yang memicunya setelah mencatat swap.
- Project Vercel `bell-wq3j` tidak lagi dipakai dan belum dihapus.
- Worker `bell-keeper-b` (Cloudflare, cron tiap menit) menjaga kalender, harga dan checkpoint.
- Workflow GitHub: `ant-session-chain` (swap per sesi), `ant-health`, `ant-delegate-renew`, `calendar-autorenew` (antrean pertama sekitar 2 Des), `einstein-auction`. Watcher halt sengaja nonaktif.

## Risiko dan hal yang perlu keputusan

1. Dompet gas tipis. Governance 0,000326 ETH (membayar perpanjangan delegate harga dan autorenew kalender, alert di bawah 0,0003), Worker sekitar 0,0005 ETH, prover 0,0002 ETH. Kalau governance habis, delegate harga bisa kedaluwarsa dan swap ditolak. Perlu ETH Robinhood Chain tambahan.
2. Brief 2 butuh keputusan modal sebelum bisa jalan.
3. V5 butuh tanggal earnings dan root kalender berikutnya.
4. Sourcify exact (P1, A7, V7) butuh rebuild dan redeploy, keputusan pemilik.
5. Kerentanan dependensi produksi diturunkan dari 22 ke 4 (25 Nov, lewat pnpm overrides dan Next 16.4.5; build dan CI hijau). Sisa 4: `zod` 3.x dan `uuid` lewat wagmi/rainbowkit, perlu lompatan versi mayor dan belum diuji. Hitungan GitHub (54) juga mencakup dependensi dev dan belum diperiksa satu per satu.
6. Belum ada tinjauan kriptografi independen (sudah tertulis di batasan jujur halaman).
