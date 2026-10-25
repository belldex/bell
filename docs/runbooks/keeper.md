# Runbook: Keeper A/B, Nonce dan Watchdog (M09, M12-03/M12-04)

## Liveness
- Keeper B: satu alarm aktif per DO; cron per menit memanggil ensureAlarm ringan, pekerjaan berat di DO (M09-05).
- Alarm berikutnya dipersist SEBELUM I/O; constructor tidak menunda alarm yang lebih awal.
- Watchdog meter mencakup duration termasuk retry; backoff bounded, tanpa busy loop.

## Nonce & pending transactions (M09-03)
- Signed bytes/hash/nonce dicatat ke `pending_submissions` SEBELUM broadcast.
- Timeout TIDAK berarti gagal: retry mengirim bytes identik.
- Replacement memakai nonce sama + fee naik eksplisit; budget retry bounded — tanpa nonce gap.
- Reconcile pending/latest + receipts + reorg sebelum memilih nonce berikutnya.

## Lease (M07-03)
- Lease 25 detik, direnew setelah setiap await dan sebelum signing.
- Lease hilang = tidak boleh submit/sign; worker overlap ditolak (fence monotonic).

## Insiden (M12-04)
1. Deteksi: watchdog/alerts menandai liveness gagal atau lag > 120 dtk (INDEX_LAGGING).
2. Ack di `incident_records` (private ops), catat hash kode/config/source terdampak.
3. Guardian boleh pause; tidak boleh sweep dana atau reset budget.
4. Recovery: bukti dua checkpoint sehat berjarak >= 60 dtk sebelum resume normal.
