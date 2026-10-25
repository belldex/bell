# Keputusan: Penggantian benchmark RPC 72 jam dengan snapshot acceptance

Tanggal: 2026-10-25 · Keputusan: pemilik proyek · Diterapkan di: Brief (§13, G35, §20.L, §20.M, index evidence) dan Plan (critical path, M14-02, §11.2)

## Keputusan
Window benchmark wall-clock "minimal 72 jam" untuk pemilihan provider RPC aktif diganti dengan **snapshot acceptance terdokumentasi**: capability matrix kedua provider, preflight head agreement pada common block (mainnet + testnet), sampel latency per metode, probe getLogs/historical/fork pada block yang dipatok. Revalidation dipicu perubahan plan/region provider atau incident provider.

## Alasan
Percepatan penyelesaian atas keputusan langsung pemilik proyek. Snapshot yang tersedia: `evidence/runtime/rpc-preflight-*.json`, `rpc-capability-matrix-2026-10-25.json`, `rpc-discovery-pinax-testnet-2026-10-25.json`.

## Risiko sisa (diakui, tidak disembunyikan)
1. Evidence satu hari tidak mencakup perilaku overnight/weekend/traffic spike — anomali berkala tidak teramati.
2. Statistik P95 dari sampel pendek lebih rentan bias dari P95 window panjang.
3. Gate Mainnet GO kini bergantung pada snapshot, bukan observasi kontinu.

## Kompensasi yang tetap berlaku
- No public fallback; failover hanya ke endpoint chainId+health benar (G35 tetap ada, hanya metodenya yang berubah).
- Ambang SLO internal tetap sama (P95<=1s, success>=99,9%, head lag P95<=2s).
- Keeper A tetap berjalan tiap 30 detik via pg_cron — telemetri operasional terakumulasi alami sejak hari pertama.
- Perubahan plan/region provider atau incident memicu revalidation penuh.
- Criteria 20.M (empat weekend + sessions) untuk mainnet availability TIDAK diubah.

## Implikasi board
Tidak ada task yang terbuka karena perubahan ini (benchmark belum mulai dihitung sebagai task terpisah); M14-02 kini bisa dieksekusi dengan snapshot tanpa menunggu jendela waktu.