# Weekend replay: LP result in a standard v4 pool vs a BELL pool

This folder replays real weekends of TSLA, NVDA and AAPL against two Uniswap v4 pools and records what the liquidity provider
keeps in each. It is the historical half of the LP proof (test B). Nothing here is a live result and nothing here is a
prediction. It is a simulation with stated assumptions, run on the real BELL contracts.

## Run it

```bash
cd contracts
forge test --match-contract WeekendReplay -vv
```

That reads `research/replay/data/replay-input.json`, runs all 60 cases (20 weekends x 3 stocks) and writes
`research/replay/results.csv`. The first run compiles the whole protocol with `via_ir` and takes about ten minutes; after that
a full replay takes seconds.

| Variable | Default | Meaning |
| --- | --- | --- |
| `REPLAY_LIMIT` | all rows | run only the first N rows |
| `REPLAY_RANDOM_ORDERS` | 8 | random auction orders per weekend, at most 23 |

Refresh the prices and redraw the charts:

```bash
node research/replay/fetch-prices.mjs     # Yahoo Finance hourly bars, last 20 complete weekends
node research/replay/make-charts.mjs      # writes the two charts as SVG and 1600x900 PNG
```

## What is simulated

Both pools get the same liquidity, the same range and the same starting price, and each weekend starts from a fresh pair.

* Capital: 100,000 USD per pool, half in the stock and half in USDG, concentrated from 75% to 130% of the Friday close.
* **Pool A.** Standard v4 pool, fixed 0.30% fee, no hook.
* **Pool B.** A real BELL pool created through `BellPoolFactory.createAndSeed`: `BellHookV2`, class SESSION_ONLY, the Opening Bell
  Auction attached by the factory, flow caps of 2.5% (trade), 10% (window) and 5% (closure) of the seed, the closed-session fee of 1.00%,
  the pre-market fee of 0.30% and the bell fee that starts at 100% and decays over 300 seconds after the reopen.

Per weekend:

1. **Friday close.** Both pools sit at the Friday post-market close (about 20:00 ET).
2. **Weekend.** An arbitrage agent that knows the Monday open price pushes Pool B toward it as far as the closed-session fee and the flow caps
   allow (a swap the hook refuses is retried at half the size). Pool A is left at the close: it has no weekend behaviour to model.
3. **Monday open (04:00 ET).** Pool A takes the first arbitrage swap, which closes the whole gap at the 0.30% fee. Pool B runs the auction:
   the arbitrage agent quotes both sides at the open price (5,000 USD each), eight pseudo-random participants add buy and sell orders with
   limits within 1% of the open and 600 to 5,000 USD each, the book clears at the maximum-volume price, the hook is checkpointed twice
   sixty seconds apart, and then the agent trades the pool toward the open price every 15 seconds for 30 minutes while the bell fee decays.
4. **Settle the books.** Both LPs withdraw. `LP net = withdrawn value (principal plus fees) - value of the same tokens held`, both valued at the open price.

## Columns of `results.csv`

One row per weekend per stock.

| Column | Meaning |
| --- | --- |
| `friday`, `symbol`, `close_usd`, `open_usd` | the weekend and the two prices the replay used |
| `gap_bps` | (open - close) / close, in basis points |
| `arb_profit_a_usd`, `arb_profit_b_usd` | arbitrage agent profit in each pool, valued at the open price |
| `lp_fees_a_usd`, `lp_fees_b_usd` | fees the LP collected |
| `lp_net_a_usd`, `lp_net_b_usd`, `*_pct` | LP result against holding, in USD and as a percent of the starting liquidity |
| `difference_usd`, `difference_pct_points` | `lp_net_b - lp_net_a` |
| `swaps_b`, `refused_swaps_b`, `last_refusal`, `last_reason_bits` | how many Pool B swaps ran, how many the hook refused, and the last refusal (diagnostic) |
| `auction_orders`, `auction_matched_usd`, `auction_clearing_vs_open_bps`, `auction_settled` | the auction cycle: orders placed, volume matched peer to peer, clearing price against the open, and whether it settled |

## What the 60 rows say

* BELL did better in 16 rows, the standard pool did better in none, and 44 rows are a tie. A difference under 0.0001 USD counts as a tie:
  it is rounding dust, not a result.
* The average LP result against holding was -0.42 basis points of the starting liquidity in the standard pool and -0.25 in BELL.
  In dollars on 100,000 per pool, the difference summed over all 60 rows is about 97 USD.
* The difference is zero when the gap is under about 1%, and positive above it. That follows from the design: the closed-session
  fee is 1.00%, so below a 1% gap neither pool leaves a profitable trade until the bell fee has decayed, and both end at the same price
  with the same fees. Above 1% the closed-session fee and the flow caps make the agent push the price in several smaller steps at higher fees.
* The losses are small in absolute terms (at most about 3.5 basis points for one stock over one weekend in the standard pool here, 1.9 in BELL) because the gaps in this sample are small and the
  liquidity is deep. A shallower pool or a bigger gap scales both losses up.

## Assumptions and limits, stated plainly

* **Not a mainnet fork.** The contracts under test are the repository's own bytecode (BellHookV2, the factory, the auction, the Uniswap v4
  PoolManager and PositionManager), deployed fresh in the test. Tokens, the calendar and the session registry are test doubles
  (`ReplayToken`, `MockCalendarRegistry`, `MockSessionRegistry`) that publish a healthy session and the calendar the replay needs. This
  tests the rules, not Robinhood Chain's live liquidity or oracle feeds.
* **Arbitrage is rational, informed and fast.** The agent knows the open price in advance, trades whenever it is profitable at the current
  fee, and has unlimited inventory. A real arbitrageur is slower and less certain, which would change both pools.
* **Auction participation is simulated.** Orders are pseudo-random and seeded by the row, and real volume may be smaller. The auction is a peer
  to peer match: it does not move the pool price. So the LP difference above comes from the closed-session fee, the flow caps and the bell fee,
  not from the auction clearing. What the auction adds is a fair price for participants (see `auction_clearing_vs_open_bps`) and a pause in swaps while it runs.
* **The weekend arbitrage in Pool A is not modelled.** A standard pool has no closed-session behaviour. The replay lets it sit at the Friday close and
  takes the whole gap at the open, as the brief specifies. In a real standard pool, weekend trading on other venues could move it earlier.
* **Price data.** Yahoo Finance public chart endpoint, one-hour bars with pre and post market (`data/weekends.json` records the URLs and the fetch time).
  The close is the last post-market bar on Friday and the open is the first pre-market bar (04:00 ET) on the next trading day. The 20:00 to 04:00 ET
  overnight session is not in this source. Bars are hourly, so every price is a bar open or close, not a tick.
* **Results depend on the gap.** Small-gap weeks show no difference. The sample is 20 weekends of three stocks from June to October 2026, which is
  a short window. The LP net figure ignores gas and any value of the LP position beyond the weekend.
* **This is a simulation, not a live result.** No weekend has been measured live against a standard pool. What has run on Robinhood Chain mainnet (one seed, swap and withdraw cycle, one withdraw, one revert above the trade cap) is listed on the /proof page; those pools are too small to say what an LP keeps.

## Files

| Path | What it is |
| --- | --- |
| `contracts/test/research/WeekendReplay.t.sol` | the replay test |
| `fetch-prices.mjs`, `data/` | price download and the input files |
| `results.csv` | the output, one row per weekend per stock |
| `make-charts.mjs`, `chart-*.svg`, `chart-*.png` | the two charts |
