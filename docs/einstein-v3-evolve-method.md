# Einstein Hooks v3 Evolve: method

This is the method for the LP economics test. It is committed before the first pool is seeded, so the rules cannot be picked after the result is known. The machine-readable version is `evidence/einstein/v3-evolve/method.json`; the code is in `scripts/einstein/v3-evolve/`.

## The question

Over a real weekend, does an LP in a BELL pool end up with more value than an LP in a plain Uniswap v4 pool with the same capital and range?

## Design

| Item | BELL pool | Control pool |
| --- | --- | --- |
| Pair | NVDA/USDG | NVDA/USDG |
| Hook | Einstein hook (session fees, caps, auction) | none |
| Fee | 0.05% regular, 0.30% pre and post, 0.50% overnight, 1% closed | fixed 0.30% |
| Capital, ticks | the same in both | the same in both |
| Seeded | the same block or the next | the same block or the next |

The Einstein hook contract is the one already deployed (v2). The page says "Hook contract: Einstein v2" unless new hook contracts are deployed.

## Windows

- Run 1: Friday 20 Nov 16:00 ET to Monday 23 Nov 10:00 ET (`startTs` 1795208400, `endTs` 1795446000).
- Run 2: Wednesday 25 Nov 16:00 ET to Monday 30 Nov 10:00 ET, over Thanksgiving.

Both are published whatever they show. A run is never deleted and no sub-window is picked.

## Reference price

Source: the Chainlink NVDA feed on Robinhood Chain, `latestRoundData()` at `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`.

The feed holds its last price over the weekend (on 14 to 16 November it last updated on Saturday 00:06 UTC and next on Monday 07:33 UTC), so a round older than 6 hours is stale.

- Per swap: the live round if it is at most 6 hours old at the swap, otherwise the first round the feed publishes after the swap (the reopen price).
- Window start: the feed at the start block.
- Window end: the feed at the last block at or before Monday 10:00 ET. It must be fresh, or claim E3 does not pass.

## Metrics

All values are in USDG, from `Swap` events only.

- **Fees earned**: input amount times the event fee, times the position's share of pool liquidity (zero when the pool tick is outside the range).
- **LVR**: (reference price minus execution price, fee taken out) times the NVDA the swapper received, times the position's share. Negative means the LP gained.
- **Value vs hold**: position value at the last Swap event's price, plus fees, minus the starting tokens valued at the end price.
- **Net LP result**: value vs hold in bps of starting capital. The headline is BELL minus control, in bps of capital.
- **Blocked flow**: swaps the BELL pool refused, each with its reverted transaction and error.

## The bot

One public bot trades both pools toward the reference price. `decideArb` in `scripts/einstein/v3-evolve/arb.mjs` is the only decision rule. It is given a pool's price, liquidity and current fee, and it trades until the price after the trade, with the fee on top, equals the reference. The size cap is the same on both pools. If a BELL cap, a fee or a closed session turns a trade away, that is the result.

## Not allowed

Cherry-picking a sub-window, changing the reference price after the fact, leaving out a session that looks bad, deleting a run.

## Limits

One asset and one weekend per run. Part of the flow is a controlled bot, labelled separately from organic flow. The control is one fee tier. If BELL loses a run, the page says so in its verdict line. Not an audit and not financial advice.
