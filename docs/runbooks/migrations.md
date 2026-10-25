# Runbook: Migrations, Cron dan Retention (M07-05)

## Prinsip
- Migrasi bersifat expand/contract: tambah dulu, verifikasi worker berjalan, baru contract.
- Downgrade tidak boleh merusak data canonical (chain_events, source_samples, calendar_*).
- Semua cron ter-install idempoten lewat tabel `scheduled_jobs`; re-run migration tidak membuat duplikat jadwal.

## Install
1. Jalankan `supabase/migrations/20261025000000_derived_state.sql` (schema).
2. Jalankan `20261025000001_rls.sql` (RLS + public views; revoke dulu, grant view terakhir).
3. Jalankan `20261025000002_leases_and_jobs.sql` (leases + fencing, SECURITY DEFINER dengan search_path eksplisit).
4. Jalankan `20261025000003_jobs_cron.sql` (jadwal cron A 30 dtk, indexer 60 dtk, maintenance 3600 dtk).

## Cron
| Job | Interval | Catatan |
|---|---|---|
| keeper-a-tick | 30 detik | auth token di env backend/Vault, bukan SQL plaintext |
| indexer-tick | 60 detik | planner 24 calls/menit terkunci di kode (M10-05) |
| maintenance | 3600 detik | `prune_cron_history()`: sukses 2 hari, gagal 7 hari |

## Rehearsal (BLOCKED offline)
Staging rehearsal butuh instance Postgres/Supabase live. Evidence `migration-cron-rehearsal` tetap terbuka sampai dijalankan; jangan klaim kompatibel tanpa itu.
