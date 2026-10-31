# Data Access and Redistribution Limits

## Current Mainnet path

Mainnet reads the public Chainlink Robinhood Chain `AggregatorV3` equity Data Feeds onchain. The active
proxies are recorded in `evidence/deploy/mainnet-4663-chainlink-session-adapters.json`; the current feed
directory snapshot is `evidence/runtime/chainlink-robinhood-feed-directory-2026-10-31.json`.

The Chainlink directory lists one `us_equities_24/5` Data Feed proxy per ticker, with an 86,400-second
heartbeat and 0.5% deviation threshold. BELL uses that same canonical proxy in phase-scoped PRE,
REGULAR, POST, and OVERNIGHT adapters. Calendar and source checks stay session-specific. Each active
execution read has a stricter 120-second age limit and fails closed when the latest onchain round is older.
That strict limit is BELL policy, not a Chainlink freshness promise; historical rounds show that it can
make swaps unavailable for long intervals. See `docs/CURRENT-STATE.md` before describing availability.

The onchain proxy and round data are public contract state. This path does not fetch or redistribute raw
Data Streams reports and does not require a Data Streams subscription or a keeper transaction to update
the Chainlink proxy.

## Chainlink Data Streams (separate paid product; not active)

Data Streams provides low-latency signed reports, including separate Regular, Extended, and Overnight
24/5 U.S. equity streams. It is not the same as the push-based onchain Data Feed above. The local mainnet
credential authenticates, but the account currently has no entitled feeds; no subscription has been
created. Evidence: `evidence/runtime/chainlink-entitlement-live-2026-10-31.json`. Do not switch the active
registry to the V11 report adapter until authorized report access is available and verified. Raw report
redistribution remains disallowed under the current rights record.

## Yahoo Finance (historical/testnet rehearsal path)

The Yahoo chart endpoint and BELL EIP-712 reporter remain in the repository for testnet rehearsal. That
path has PRE/REGULAR/POST coverage but no overnight source; it is not the active Mainnet price path. Yahoo
does not sign its HTTP responses. Do not describe its prices as provider-signed, or infer commercial
redistribution rights from public HTTP access. See `docs/runbooks/yahoo-source.md` for its testnet details.

## Internal data

- `incident_records`, `service_metrics`, and `job_lease_history` are PRIVATE_OPS with default-deny RLS.
- AES-256-GCM encrypted backups go to a private bucket; keys stay in the local secret manager.
- The frontend receives sanitized data through public views and a typed API.
