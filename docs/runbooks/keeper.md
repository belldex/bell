# Runbook: Keeper A/B, Nonces, and Watchdog (M09, M12-03/M12-04)

## Liveness
- Keeper B: one active alarm per DO; a per-minute cron calls lightweight ensureAlarm, while heavy work runs in the DO (M09-05).
- The next alarm is persisted BEFORE I/O; the constructor does not delay an earlier alarm.
- The watchdog meter includes duration and retries; backoff is bounded, with no busy loop.

## Nonce & pending transactions (M09-03)
- Signed bytes/hash/nonce are recorded in `pending_submissions` BEFORE broadcast.
- A timeout does NOT mean failure: retries send identical bytes.
- Replacement uses the same nonce with an explicit fee increase; retry budget is bounded, with no nonce gap.
- Reconcile pending/latest + receipts + reorg before choosing the next nonce.

## Lease (M07-03)
- Lease lasts 25 seconds and is renewed after every await and before signing.
- If the lease is lost, submission/signing is forbidden; overlapping workers are rejected (monotonic fence).

## Incidents (M12-04)
1. Detection: watchdog/alerts indicate failed liveness or lag > 120 sec (INDEX_LAGGING).
2. Acknowledge in `incident_records` (private ops) and record hashes of affected code/config/source.
3. The guardian may pause; it must not sweep funds or reset the budget.
4. Recovery: require evidence of two healthy checkpoints at least >= 60 sec apart before normal resume.

## Live wiring (2026-10-25, project yaulnphhomzbfkpjeklh)
- Active extensions: pg_cron 1.6.4 + pg_net 0.20.4 (schema `extensions`).
- Cron job `keeper-a-tick` (jobid 1, `30 seconds`): `net.http_post` to the `keeper-a` edge function; the `x-cron-secret` header is read from `private.cron_secrets` (the schema is not exposed through PostgREST).
- Do NOT use `supabase_vault` for inserts via the postgres role: the platform blocks `_crypto_aead_det_noncegen` even when GRANT EXECUTE has been issued. The cron secret is stored in `private.cron_secrets`.
- Secret format: 64 hex-only characters. Non-hex characters risk truncation when passed through the shell (previously, a 49-character env value vs. a 48-character db value).
- Secret rotation: (1) `supabase secrets set CRON_SECRET=...`, (2) `UPDATE private.cron_secrets ...`. Both must stay in sync.
- Keeper-a edge function: acquire a 25s lease (monotonic fence) -> honest no-op without oracle entitlement (M01) -> release (`expires_at = now()`; row persists for audit and is immediately reclaimable).
- Live evidence: `evidence/runtime/pg-cron-keeper-live-2026-10-25.json` (5 cron runs `succeeded` at 30s intervals, fence up to 10).

## Keeper status vs. price source (2026-10-27)

Keeper A is still a **no-op**. It has not been routed to the Yahoo path: the keeper does not call
`submitReports` or `refreshHealth` on the testnet SessionRegistry, and quote retrieval is not scheduled.
Keeper B (Cloudflare DO) is not pointed at any testnet address either.

Important: Yahoo sample freshness is **not** currently maintained by the keeper. The last sample was
5500 seconds old at trace time, meaning it had not been updated. See `docs/CURRENT-STATE.md` §4.4.

What is required before the keeper can maintain prices:

1. An admitted stock descriptor and a valid calendar interval; otherwise `refreshHealth` will reject it.
2. The keeper must hold the reporter key or call a signing service that holds it. Currently, the reporter
   key is used manually through `scripts/deploy/publish-yahoo-direct.mjs` only.
3. An explicit RPC budget/quota for the tick frequency; Yahoo requires no API key, but testnet RPC still
   has a free-tier quota.
