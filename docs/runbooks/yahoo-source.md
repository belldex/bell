# Yahoo public quote source (free-provider path)

This path does **not** use `CANDLESTICK_API` or Chainlink Data Streams. It reads the public Yahoo
Finance chart endpoint:

```text
https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval=1m&range=1d
```

Example preview:

```powershell
node scripts/deploy/yahoo-report.mjs --symbol=AAPL --scope=1
```

The parser uses the most recent non-future one-minute `close`, normalizes it to 1e18 with integer
arithmetic, maps Yahoo's PRE/REGULAR/POST periods, and rejects observations older than the current
BELL policy window (120 seconds). For direct adjusted-token prices, pass `--token=<official CA>`;
the reporter reads `uiMultiplier()` from the configured Mainnet RPC and applies it once.

## Onchain attestation model

Yahoo does not sign its public HTTP response. `YahooSourceVerifier` verifies a BELL-selected EIP-712
reporter key; `YahooAttestedSourceAdapter` binds each signed observation to chainId, verifier,
SourceWire hash, ticker-derived feedId, phase, price, timestamps and report hash. The regular stream
wire uses custom schema 12; the direct adjusted-token wire uses source kind 1. Stale/future samples,
wrong phase/feed, reporter mismatch and replay are rejected. The attester is a trusted BELL signer,
not Yahoo cryptographic verification, so reporter key protection is a new oracle trust boundary.

Report preview/signing:

```powershell
node scripts/deploy/yahoo-report.mjs --symbol=AAPL --scope=1
node scripts/deploy/yahoo-report.mjs --symbol=AAPL --scope=1 --sign
```

`--sign` requires a **separate** `YAHOO_REPORTER_PRIVATE_KEY`, the deployed verifier address, and the
exact per-adapter SourceWire hash in local `.env`. It never uses governance/treasury or the Chainlink
key. `--broadcast` can publish a direct price to an adapter or submit a phase report to
SessionRegistry after the asset/adapter configuration exists. The CLI never sends a transaction by
default.

## Coverage and limitations

- Public Yahoo chart metadata exposes PRE, REGULAR and POST periods; it does not establish BELL's
  Robinhood OVERNIGHT session feed. Do not mark OVERNIGHT healthy without another real source.
- Yahoo's free endpoint is an unsigned external input and may be delayed, throttled, changed or stale.
  The 120-second freshness check remains active; unavailable/stale quotes mean health fails closed.
- The API fetch is real market data, but commercial/data-redistribution rights have not been reviewed.
  No raw response is persisted in public evidence. This runbook is not a mainnet source-rights approval.
- Official Robinhood tokenized-stock contracts are listed on Mainnet only by the official assets API
  snapshot currently captured; no official AAPL/TSLA/NVDA token is listed on Testnet 46630. Testnet
  create-and-seed of an official Robinhood stock token therefore remains unavailable.
- Mainnet Reporter/Adapter deployment, source-wire admission, session health/calendar, price cross-check,
  fork/gas tests and independent review remain release gates. No Mainnet transaction is authorized by
  this runbook.
