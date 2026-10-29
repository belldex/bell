# BELL testnet — honest status

Last verified: 2026-10-29 03:40 UTC (chain 46630, block ~144.5M)

## What is actually proven onchain

| Item | State | Evidence |
|---|---|---|
| Protocol stack (12 contracts) | deployed, code + bindings verified | acceptance 82/82 |
| Long calendar for current asset | **committed and active** | root `0xb525e86d…`, 127 leaves, 60 days |
| Keeper publish payload | **accepted by the real contracts** | `verify-keeper-payload.mjs` — 5/5 `eth_call` pass (PRE + REGULAR direct, stream, refreshHealth) |
| Cloudflare keeper | **running** | 139+ ticks, 30s alarm, cron `*/1 * * * *` |
| GitHub Actions keeper backstop | **running** | run 40809595921 success |
| CI `check` workflow | **green** | run 40808666109 success |
| Production site | **live** | https://bell-black.vercel.app — 9 routes verified 200 |

## What is NOT proven yet

| Item | Why | When |
|---|---|---|
| A report published by the Worker itself | market closed; calendar phase is CLOSED (no Yahoo source) | after 08:00 UTC (PRE open) |
| Pool bound to the current asset | `create-testnet-pool` refuses CLOSED phase; hook salt mining needs real CPU | first PRE/REGULAR session, via `rehearsal-keeper` workflow |
| Swap + acceptance on the current asset | depends on the pool above | after the pool exists |
| UI pointing at the current pool | `LiveSwapPanel`/`RehearsalPoolCard` still reference the previous hook | after the new hook is mined |

## Why the previous pools died

1. The first calendar committed a single 30-minute leaf. The registry is append-only per
   `(asset, year)`, so it could never be extended — that asset identity was spent.
2. `keeper-b` was a scaffold: its `alarm()` only incremented a counter.
3. A single-tick keeper threw on a closed market instead of exiting cleanly.

All three are fixed. The current asset has a 60-day calendar, the Worker really signs and
publishes, and a closed market is a clean no-op.

## What to check when the session opens

```bash
# 1. keeper published?
curl -s https://bell-keeper-b.asysyifaq25.workers.dev/status

# 2. calendar + health
node scripts/deploy/ci-rehearsal-status.mjs

# 3. pool created by CI?
gh run list --repo belldex/bell --workflow rehearsal-keeper.yml --limit 3

# 4. acceptance against the current pool
BELL_EXPECTED_CALENDAR_PHASE=1 node scripts/deploy/final-testnet-acceptance.mjs
```

## Known risks

- Reporter ETH balance is thin (~0.0009). Each tick costs gas; if it runs dry the Worker will
  report `failed` in `/status` instead of silently stalling. Top it up before a long run.
- The calendar has no holiday table. A market holiday looks like a normal session to the
  calendar, but the keeper's quote freshness check stops publication, so no stale price is
  published — the pool simply halts, which is the intended fail-closed behaviour.
- The Alchemy API key appeared in earlier terminal error output and should be rotated.
