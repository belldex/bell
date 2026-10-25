# Hak akses & batas redistribusi data (M01-04)

## Chainlink Data Streams (sumber harga eksekusi)
- Akses = entitlement per API key (username + HMAC secret). Kredensial di `.env` (gitignored), tidak pernah masuk log/source/chat-final.
- **Redistribusi laporan mentah tanpa hak TIDAK DIIZINKAN** (R42: rate limits/rights mengikuti agreement aktual). Report hanya dipakai internal untuk guard/quote/verify on-chain.
- Robinhood equity streams = hidden streams: visible hanya bagi key berentitlement aktif (terbukti live 2026-10-25: listFeeds entitled = 0 sebelum subscribe).
- Snapshot plan: Free-tier RPC hanya untuk chain data; Data Streams subscription = keputusan bisnis terpisah (belum aktif per 2026-10-25).

## Data on-chain (publik)
- state/log/block via authenticated RPC: boleh dibaca, disimpan, ditampilkan ulang (data publik konsensus).
- Feed push-based Chainlink (R40, heartbeat 24 jam): metadata proxy publik; HANYA acuan harian, tidak pernah harga eksekusi.

## Data internet (indikatif)
- Boleh untuk UI/display dengan disclaimer "indicative" dan sumber tercantum.
- TIDAK BOLEH masuk jalur signing/keeper/verifikasi on-chain (tidak ada signature kriptografis).

## Penyimpanan internal
- `incident_records`, `service_metrics`, `job_lease_history` = PRIVATE_OPS (RLS default-deny).
- Backup terenkripsi AES-256-GCM ke bucket privat; kunci di secret manager lokal.
- Frontend hanya menerima data sanitasi via view publik + API typed.
