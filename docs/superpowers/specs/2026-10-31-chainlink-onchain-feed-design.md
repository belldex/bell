# Chainlink Onchain Equity Feed Design

## Status

Deployed and code-verified on Robinhood Chain Mainnet on 2026-10-31. Three stock adapters, new asset descriptors, 60-day calendar roots, and the Chainlink-mode keeper are active. See `docs/CURRENT-STATE.md` and Mainnet deployment evidence for addresses and transaction records.

## Decision

Read Robinhood Chain's existing Chainlink `AggregatorV3` equity feeds directly from BELL contracts. Do not use Chainlink Data Streams for this integration. A swap or create-pool preflight performs an onchain freshness check; there is no recurring price publication transaction.

The Robinhood feeds publish token total-return value, calculated as underlying equity price multiplied by the token's `uiMultiplier`. BELL's session policy and close-anchor logic already applies that multiplier, so a pinned adapter divides the feed answer by the current token multiplier to recover the underlying price. It rejects a paused issuer oracle, invalid round, changed feed/token code, or a round at least 120 seconds old. The independent direct-price adapter continues to read the same Robinhood feed as the token-adjusted comparison value.

The price and calendar inputs must agree before BELL allows a swap. The calendar exposes PRE, REGULAR, POST, and OVERNIGHT phases; missing or stale data fails closed. A valid Mainnet calendar closes Friday at 17:00 Eastern, matching the documented end of the Robinhood Chainlink feed window, and reopens Sunday at 20:00 Eastern, matching Robinhood's 24 Hour Market opening. The calendar includes published 2026–2028 NYSE holidays and early closes.

## Transaction paths

- Swap UI sends an empty `OraclePullUpdate[]`. `SessionRegistry` refreshes stock health from the configured onchain feed in the same router transaction before policy evaluation.
- Pool creation uses the same empty update path to check every stock leg's freshness before it creates a pool.
- During the five-minute window before a supported session closes, the Cloudflare Worker calls `captureClose` directly. It does not fetch Yahoo or publish a price report.
- Closed-session swaps use the captured historical anchor. The current feed may be stale while markets are closed, so it is not used as a live price then.

## Mainnet migration

The previous registries and pool hooks are immutable. The replacement protocol deployment now reads kind-5 Chainlink session wires from `SessionRegistry`; adapters are deployed for AAPL/NVDA/TSLA, and the new AssetRegistry admits WETH/USDG, those three stocks, and MEME with no price source and SESSION_ONLY-only use. Complete 60-day calendar roots are active. The keeper points to the new manifest. Existing pools remain bound to old hooks; there are no pools on the replacement factory.

## Operational limits

- The feed can hold the last value during thin overnight activity, holidays, or issuer pauses. Chainlink documents no off-hours heartbeat. A round older than 120 seconds halts active swaps even when its numeric answer has not changed.
- The Chainlink 24/5 feed availability is not the same as guaranteed fresh updates for every symbol. PRE, POST, or OVERNIGHT may be temporarily unavailable under the freshness rule.
- `captureClose` also requires a valid feed round at the close. If the feed has already gone stale, the historical anchor is not created and the next closed period stays halted.
- Reading a Chainlink feed has no Data Streams subscription, but user swaps and the close-capture transaction still consume Robinhood Chain gas.

## Source references

- [Robinhood Tokenized Equities: total-return value, sessions, pause, and off-hours behavior](https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood)
- [Chainlink Data Feed market hours](https://docs.chain.link/data-feeds/selecting-data-feeds)
- [Robinhood 24 Hour Market hours](https://robinhood.com/us/en/support/articles/weekend-investing/)
- [NYSE holidays and early closes](https://www.nyse.com/trade/hours-calendars)
