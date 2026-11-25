# Status Brief 1, 2 dan 3

Dicatat 25 November 2026 (UTC). Angka berasal dari verifier di repo (`scripts/einstein/verify-einstein-pool.mjs`, `verify-einstein-ant.mjs`) yang dijalankan terhadap RPC arsip mainnet 4663. Kalau ada angka di sini yang beda dengan halaman live, halaman live yang benar.

Legenda: PASS = terbukti on-chain dan diputar ulang. PARTIAL = sebagian terbukti. PENDING = belum dibuktikan. Tidak ada FAIL.

## Brief 1: Einstein Hooks v2 dan pool NVDA/USDG

Hasil verifier: 13 PASS, 2 PARTIAL, 3 PENDING, 0 FAIL.

| Klaim | Status | Catatan |
| --- | --- | --- |
| P1 Kode sama dengan yang diklaim | PARTIAL | Sourcify: 1 dari 16 kontrak exact, 15 lainnya match. Build tanpa metadata hash, jadi exact butuh rebuild dan redeploy. Pemilik memilih membiarkan match. |
| P2 Tidak bisa diubah belakangan | PASS | Slot EIP-1967 nol di 15 kontrak dan hook pool. |
| P3 Izin hook sesuai | PASS | Hook mask 0x2cc0, bit remove-liquidity mati. |
| P4 Pool nyata dan berlikuiditas | PASS | Dibuat dan di-seed dalam satu tx, blok 114372026. |
| P5 Kalender ditandatangani post-quantum | PASS | Tiga panggilan governance (ECDSA dan SHRINCS). |
| P6 Fee sesi berlaku | PASS | Swap nyata di CLOSED, OVERNIGHT, PRE, REGULAR, POST. |
| P7 Auction jalan dengan order nyata | PENDING | Siklus 16 Nov tanpa order. Workflow `einstein-auction` jalan di CI Jumat 27 Nov 00:20 UTC (07:20 WIB) dan Senin berikutnya. Berhenti sendiri setelah ada siklus bervolume. |
| P8 Selalu bisa keluar | PASS | Exit saat CLOSED dan saat pause, tanpa hook dan tanpa tanda tangan PQ. |
| P9 Kegagalan aman | PARTIAL | N1 sampai N5 dan N7 revert dengan error bernama. N6 belum dikirim. |
| P10 Biaya verifikasi PQ | PASS | 323.735 gas lawan 70.433 (sekitar 4,6 kali). |
| P11 Siapa pun bisa cek | PENDING | Hasil terakhir yang tercatat masih menyebut 3 PENDING. Selesai kalau P7 dan N6 selesai. |
| N6 | PENDING | Swap biasa yang dikirim di dalam jendela order auction harus revert dengan AuctionActive. Dikerjakan oleh siklus auction yang sama dengan P7. |

Yang masih terbuka di Brief 1: P7, N6, P11 menunggu siklus auction. P1 exact tidak dikerjakan (keputusan pemilik). Kalender AAPL dan TSLA di stack lama tidak diperpanjang otomatis.

## Brief 2: Einstein v3 Evolve (ekonomi LP, NVDA/USDG)

Status: belum jalan di mainnet. Metode sudah di-commit (`docs/einstein-v3-evolve-method.md`, `evidence/einstein/v3-evolve/method.json`).

| Run | Status |
| --- | --- |
| Run 1, 20 sampai 23 Nov | Tidak dimulai. Pool tidak didanai tepat waktu, tidak ada yang di-seed dan tidak ada yang diukur. Ditandai postponed. |
| Run 2, Thanksgiving 25 sampai 30 Nov | Dijadwalkan, mulai 25 Nov 21:00 UTC. Belum didanai. |
| Run 3, testnet 21 sampai 23 Nov | Selesai (final). Menguji mekanisme dengan token uji dan feed harga fixture, bukan ekonomi mainnet. |

Yang menahan: keputusan modal. Dua pool (BELL dan kontrol tanpa hook) harus di-seed dengan jumlah USD yang sama dan range yang sama. Tidak ada klaim dari Brief 2 yang bisa dibuat sebelum itu.

## Brief 3: ANT/USDG dan Einstein Hooks v3

Hasil replay: 12 PASS, 3 PARTIAL, 1 PENDING. Pool 0x4a956b0c5cd1c87f7480d652099a2f346667b7d978b6d8d6441a1c39664e5940, hook 0x5839006Fdb458b81e50d9d393A775c1B5F406cc0, dibuat di blok 121908958 dengan seed 4,8 USDG.

| Klaim | Status | Catatan |
| --- | --- | --- |
| A1, A2, A3, A4, A6 | PASS | Token ANT Robinhood, kalender PQ, pool dibuat, hook, swap di atas cap revert TradeCapExceeded. |
| M1, M2 | PASS | Admisi di AssetRegistry dan root kalender aktif. |
| V1, V2, V3, V4, V6 | PASS | Halt hybrid, resume dan auction (AuctionActive), halt tanpa tanda tangan PQ revert, halt yang lapse sendiri, exit saat HALTED. |
| A5 Fee tiap sesi | PARTIAL | Baru OVERNIGHT (5000 pips) dan PRE (3000 pips) tercatat. REGULAR, POST, CLOSED belum. |
| A7, V7 Sourcify | PARTIAL | Match, bukan exact. Pemilik memilih membiarkan. |
| V5 Swap di jendela earnings | PENDING | Butuh tanggal earnings sungguhan dan root kalender berikutnya. Root sekarang berlaku sampai 1 Jan 2027 dan registry menolak root yang tumpang tindih. Kodenya sudah dibuat dan diuji. |
| B1 | Blocker | Chainlink tidak punya feed ANT. Harga di-attest BELL lewat kunci delegate. Ini asumsi kepercayaan dan tertulis di halaman. |

Jadwal A5 (otomatis, workflow `ant-session-chain`): REGULAR 25 Nov 14:30 UTC, POST 25 Nov 21:00 UTC, CLOSED 26 Nov 01:00 UTC. Kalau lolos semua: 13 PASS, 2 PARTIAL, 1 PENDING.

Catatan kejadian: swap REGULAR dan POST tanggal 24 Nov terlewat. Rantai swap berhenti dua kali karena dompet gas Worker kosong, sehingga Worker tidak mengaktifkan interval kalender dan menolak update harga. Dompet diisi 0,0005 ETH (tx 0x793c97662bf5647d905204fad7b22b412f6d33caf0d1e37e4ce3e3f3c4ce01be) dan rantai sekarang mencoba ulang error yang muncul sebelum swap terkirim.

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
