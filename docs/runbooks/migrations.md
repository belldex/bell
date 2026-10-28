# Runbook: Migrations, Cron, and Retention (M07-05)

## Prinsip
- Migrasi bersifat expand/contract: tambah dulu, verifikasi worker berjalan, baru contract.
- Downgrades must not damage canonical data (chain_events, source_samples, calendar_*).
- All cron jobs are installed idempotently through the `scheduled_jobs` table; rerunning a migration does not create duplicate schedules.

## Install
1. Run `supabase/migrations/20261025000000_derived_state.sql` (schema).
2. Run `20261025000001_rls.sql` (RLS + public views; revoke first, grant the view last).
3. Run `20261025000002_leases_and_jobs.sql` (leases + fencing, SECURITY DEFINER with an explicit search_path).
4. Run `20261025000003_jobs_cron.sql` (cron schedules: A every 30 sec, indexer every 60 sec, maintenance every 3600 sec).

## Cron
| Job | Interval | Notes |
|---|---|---|
| keeper-a-tick | 30 seconds | Auth token in backend env/Vault, not plaintext SQL |
| indexer-tick | 60 seconds | Planner is locked to 24 calls/minute in code (M10-05) |
| maintenance | 3600 seconds | `prune_cron_history()`: successes 2 days, failures 7 days |

## Rehearsal (BLOCKED offline)
Staging rehearsal requires a live Postgres/Supabase instance. Evidence `migration-cron-rehearsal` remains open until it is run; do not claim compatibility without it.
