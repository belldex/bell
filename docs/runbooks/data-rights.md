# Data Access and Redistribution Limits (M01-04)

Status of this file: `config/sources/rights-status.json` → **BLOCKED_ACCESS**. No source has been
admitted for production.

## Direction change: Chainlink → Yahoo

The current price path is **the public Yahoo Finance chart + a BELL EIP-712 reporter**.
Chainlink Data Streams was dropped because it is paid. Therefore:

- The Chainlink section below is retained as historical documentation, not as an active path.
- The current data-rights question concerns **Yahoo**, and it **has not been answered**.

## Yahoo Finance (jalur aktif)

- Endpoint: `query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}`. Gratis, tanpa API key.
- Yahoo does **not sign** its HTTP responses. Cryptographic assurance is provided by the BELL reporter
  (`YahooSourceVerifier` + EIP-712), not Yahoo. This makes the reporter key a new trust boundary that must
  be protected like an oracle key.
- Session coverage: PRE, REGULAR, POST. **There is no OVERNIGHT feed.** Yahoo must not be used to claim
  overnight sessions are healthy.
- Unresolved limits that must not be claimed as settled:
  - rights to redistribute derived prices to product users (`derivedCustomerProduct` = NOT_VERIFIED);
  - rights to store/back up raw prices (`encryptedBackup` = NOT_VERIFIED);
  - hak pemrosesan internal (`internalProcessing` = NOT_VERIFIED).
- **Allowed**: display indicative prices in the UI with a disclaimer and cited source.
- **Not allowed**: describe Yahoo prices as "provider-signed" or treat public access as permission for
  commercial redistribution.

## Chainlink Data Streams (historical, not in use)

- Akses = entitlement per API key (username + HMAC secret). Kredensial di `.env` (gitignored).
- Redistribution of raw reports without rights is not permitted; reports are only for guard/quote/verify.
- Robinhood equity streams are hidden streams, visible only to keys with active entitlement.
- Probe 2026-10-26: the Testnet endpoint returned `Unauthorized` because the available credentials were
  mainnet-only. This, along with cost, prompted the pivot.

## Data on-chain (publik)

- State/log/block data via authenticated RPC may be read, stored, and redisplayed (public consensus data).
- Push-based on-chain feeds (24-hour heartbeat): public proxy metadata; daily reference only, never used as
  an execution price.

## Data internet indikatif

- May be used in the UI/display with an "indicative" disclaimer and cited source.
- Must not enter signing/keeper/on-chain verification paths without BELL attestation.

## Penyimpanan internal

- `incident_records`, `service_metrics`, `job_lease_history` = PRIVATE_OPS (RLS default-deny).
- AES-256-GCM encrypted backups go to a private bucket; keys are in the local secret manager.
- The frontend only receives sanitized data through public views + a typed API.

## What will unblock this

1. The project owner's decision on Yahoo data usage scope (indicative only vs. derived product).
2. If a paid path with clear rights is needed, select an SLA-backed provider; this is a separate cost decision,
   independent of the technical work.
3. Once a decision is made, populate `config/sources/rights-status.json` so M01-04 can proceed.
