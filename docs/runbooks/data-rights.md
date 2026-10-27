# Hak akses & batas redistribusi data (M01-04)

Status berkas ini: `config/sources/rights-status.json` → **BLOCKED_ACCESS**. Belum ada sumber yang
diadmit untuk produksi.

## Perubahan arah: Chainlink → Yahoo

Jalur harga yang dipakai sekarang adalah **Yahoo Finance chart publik + reporter EIP-712 BELL**.
Chainlink Data Streams ditinggalkan karena berbayar. Karena itu:

- Bagian Chainlink di bawah tetap disimpan sebagai catatan historis, bukan sebagai jalur aktif.
- Yang sekarang menjadi pertanyaan hak data adalah **Yahoo**, dan pertanyaan itu **belum dijawab**.

## Yahoo Finance (jalur aktif)

- Endpoint: `query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}`. Gratis, tanpa API key.
- Yahoo **tidak menandatangani** respons HTTP-nya. Yang memberi jaminan kriptografis adalah reporter
  BELL (`YahooSourceVerifier` + EIP-712), bukan Yahoo. Ini berarti kunci reporter menjadi
  trust boundary baru yang harus dijaga seperti kunci oracle.
- Cakupan sesi: PRE, REGULAR, POST. **Tidak ada feed OVERNIGHT.** Sesi overnight tidak boleh
  dinyatakan sehat dari Yahoo.
- Batas yang belum jelas dan tidak boleh diklaim selesai:
  - hak redistribusi harga turunan ke pengguna produk (`derivedCustomerProduct` = NOT_VERIFIED);
  - hak penyimpanan/backup harga mentah (`encryptedBackup` = NOT_VERIFIED);
  - hak pemrosesan internal (`internalProcessing` = NOT_VERIFIED).
- Yang **boleh**: menampilkan harga indikatif di UI dengan disclaimer dan sumber tercantum.
- Yang **tidak boleh**: menyatakan harga Yahoo sebagai "provider-signed", atau menganggap
  akses publik sama dengan izin redistribusi komersial.

## Chainlink Data Streams (historis, tidak dipakai)

- Akses = entitlement per API key (username + HMAC secret). Kredensial di `.env` (gitignored).
- Redistribusi laporan mentah tanpa hak tidak diizinkan; laporan hanya untuk guard/quote/verify.
- Robinhood equity streams = hidden streams, hanya terlihat bagi key berentitlement aktif.
- Probe 2026-10-26: endpoint Testnet mengembalikan `Unauthorized` karena kredensial yang ada
  mainnet-only. Ini yang memicu pivot, bersama faktor biaya.

## Data on-chain (publik)

- State/log/block via RPC berautentikasi: boleh dibaca, disimpan, ditampilkan ulang (data konsensus
  publik).
- Feed push-based on-chain (heartbeat 24 jam): metadata proxy publik; hanya acuan harian, tidak
  pernah dipakai sebagai harga eksekusi.

## Data internet indikatif

- Boleh untuk UI/display dengan disclaimer "indicative" dan sumber tercantum.
- Tidak boleh masuk jalur signing/keeper/verifikasi on-chain tanpa atestasi BELL.

## Penyimpanan internal

- `incident_records`, `service_metrics`, `job_lease_history` = PRIVATE_OPS (RLS default-deny).
- Backup terenkripsi AES-256-GCM ke bucket privat; kunci di secret manager lokal.
- Frontend hanya menerima data sanitasi via view publik + API typed.

## Yang membuka blokir ini

1. Keputusan pemilik proyek tentang cakupan penggunaan data Yahoo (indikatif saja vs turunan produk).
2. Kalau butuh jalur berbayar dengan hak jelas: pilih provider ber-SLA, dan itu keputusan biaya
   terpisah dari pekerjaan teknis.
3. Setelah keputusan ada, `config/sources/rights-status.json` diisi dan M01-04 baru bisa bergerak.
