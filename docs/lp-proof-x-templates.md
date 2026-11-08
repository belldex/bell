# X content templates: LP proof

Fill the brackets from the files named in each template. Publish nothing before the tests it quotes have run.
Every number must be copied from `research/replay/results.csv`, `deployments/rule-tests.json` or a transaction on the explorer.

## 1. Historical Replay release (Sunday 23 Nov)

> We replayed [N] real weekends of TSLA, NVDA and AAPL against two pools: a standard Uniswap v4 pool and a BELL pool.
> Same liquidity, same range, same Friday close.
>
> Result: the LP in the standard pool lost [A] bp against holding. The LP in the BELL pool lost [B] bp.
> Weekends with a gap under 1%: no difference. Weekends with a gap of 1% or more: [bigGapA] bp against [bigGapB] bp.
>
> It is a simulation. The arbitrage agent is perfect and the auction orders are simulated.
> Script, prices and every row are public: github.com/belldex/bell/tree/main/research/replay
>
> [chart 1]

Second post, with the scatter chart:

> The bigger the weekend gap, the bigger the difference. Below about 1% both pools end up the same.
> We publish the weeks where nothing happened too. [chart 2]

## 2. Weekend Report (Monday 16 Nov, after test A)

> This weekend we played the arbitrageur against our own pools.
>
> TSLA/USDG, [amount] in a standard v4 pool and [amount] in a BELL pool. Friday close [price], Monday open [price], gap [gap]%.
>
> Standard pool LP vs holding: [x]. BELL pool LP vs holding: [y]. Arbitrage profit taken from each pool: [a] and [b].
> Every transaction: [link to the list]. The script we used: [link].
>
> One weekend is one data point. We will keep publishing them, including the ones that do not favour BELL.

## 3. Opening Bell live (Monday 9 Nov, after test C)

> The Opening Bell Auction ran on [pair] at the open. [N] orders, clearing price [price], [matched] matched peer to peer.
> Settle transaction: [link].

## Rules for these posts

* Say "simulation" for the replay and "live" only for transactions that happened on mainnet.
* Do not say BELL "protects" or "guarantees" anything. Say what the numbers were.
* Do not invite anyone to fund the comparison pools.
* No third-party logos in the charts.
