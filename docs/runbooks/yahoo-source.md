# Yahoo Public Quote Source (active path)

This path uses neither `CANDLESTICK_API` nor Chainlink Data Streams. Its source is the public Yahoo Finance
chart endpoint:

```text
https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval=1m&range=1d&includePrePost=true
```

`includePrePost=true` is required. Without it, no candles are returned outside 09:30–16:00 ET and every fetch
fails the 120-second freshness policy. This has caused a real bug before.

CDN note: `query1` provides fresh data; `query2` has lagged by about 10 minutes in the past.

## Contracts deployed on testnet 46630

| Role | Address |
|---|---|
| `YahooSourceVerifier` | `0x20a066123c260bc6c5253f75e261c5056fde4bea` |
| Adapter direct (scope 0) | `0xdcc4fa3e0fa29361616799a891cc1dd2eaf61806` |
| Adapter regular (scope 1) | `0x00a7e4845a25cbed8f15510d4b2ead9ec37c0ccd` |
| Adapter extended (scope 2) | `0x71ed9d187628fbd2bbd7f7c9d8aeb80b1b12f03c` |
| Adapter overnight (scope 3) | `0x86da1e4a1b2a20321ad7cd9eec5b99061ba4ccf6` |
| Reporter (EOA) | `0x6C8bAF28eA08DD00A1A64EE350167A70A7b3E98a` |

`AaplTestnetFacade` at `0x64a82eb01d7c7310ef1bc5f0055f758409d45c63` is **not** a canonical token.
It exists only because the stream-mode adapter constructor requires `stockToken.code.length != 0` on the
deployment chain, while AAPL Mainnet has no code on Testnet. Never describe it as a stock.

## Model atestasi

Yahoo does not sign HTTP responses. What is verified on-chain is the EIP-712 signature from the reporter
selected by BELL. `YahooAttestedSourceAdapter` binds each observation to chainId, verifier, SourceWire hash,
ticker-derived feedId, phase, price, timestamp, and report hash.

- Wire stream memakai custom schema 12; wire direct adjusted-token memakai source kind 1.
- Rejected: stale samples, future samples, incorrect phase/feed, incorrect reporter, and replays.
- **Trust boundary:** the reporter is a trusted BELL signer, not cryptographic verification by Yahoo.
  Protecting the reporter key is a new responsibility not present in the Chainlink path.

The signature must use the **verifier** chainId (46630 on testnet), not the canonical token chainId (4663).
This has also caused a bug before.

## Perintah

```powershell
# Preview a quote (does not send a transaction)
node scripts/deploy/yahoo-report.mjs --symbol=AAPL --scope=1

# Preview + sign (requires YAHOO_REPORTER_PRIVATE_KEY)
node scripts/deploy/yahoo-report.mjs --symbol=AAPL --scope=1 --sign

# Publish a direct price to the adapter
node scripts/deploy/publish-yahoo-direct.mjs
```

`--sign` requires a separate `YAHOO_REPORTER_PRIVATE_KEY`, a deployed verifier address, and the per-adapter
SourceWire hash in `.env`. The CLI never uses the governance/treasury key.

## Current sample status — important

Sampel direct terakhir:

| Field | Value |
|---|---|
| `price18` | `342944023940939432439` |
| `observedAt` | `1793089910` |
| age at trace 2026-10-27 | 5500 seconds |
| `validUntil` | `1793090030` (expired) |

The first publish succeeded, but **there is no currently valid price**. The policy rejects observations
older than 120 seconds, and this sample exceeds that limit by a factor of 45. None of the three stream
adapters has a sample yet—`readCurrent()` reverts with `WrongAdapterMode()` because they are in stream mode,
not direct mode.

## Scope limitations

- Yahoo public chart metadata exposes PRE, REGULAR, POST. There is **no** OVERNIGHT feed. Do not mark an
  overnight session healthy without another source.
- This free endpoint is unsigned external input and may be delayed, throttled, changed, or stale. The
  120-second freshness check remains active; unavailable/stale quotes fail health closed.
- The fetched data is real market data, but commercial/redistribution rights have not been reviewed. See
  `docs/runbooks/data-rights.md`. No raw response is stored in public evidence.
- Official Robinhood stock tokens exist only on Mainnet 4663 according to the official API snapshot. There
  are no official AAPL/TSLA/NVDA tokens on 46630.
- Mainnet adapter/verifier deployment, SourceWire admission, session calendar/health, price cross-checks,
  fork/gas tests, and independent review remain release gates. This runbook does not authorize any Mainnet
  transaction.

## Bukti

- `evidence/deploy/yahoo-verifier-adapter-testnet.json` — deploy + publish pertama
- `evidence/runtime/mainnet-readonly-price-source-review-2026-10-26.json` — sampel read-only Mainnet
- `docs/CURRENT-STATE.md` — current system state
