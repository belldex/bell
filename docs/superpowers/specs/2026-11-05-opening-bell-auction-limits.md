# Opening Bell Auction — acknowledged limits

- Escrow is custodial for the length of the window. `cancelOrder` before cutoff and
  `claimUnfilled` after settlement/timeout are permissionless, but user assets sit in the auction
  contract while the cycle is active. Product copy must disclose this.
- Clearing needs two-sided flow. With a one-sided or non-crossing book, the cycle settles with zero
  fills and all order input is refundable. The protocol never disguises a market order as a
  uniform-price auction by routing one-sided flow into the AMM.
- There is no trusted solver. `settle()` takes no price, fills, or payout arguments; the contract
  evaluates the bounded limit-price candidates, selects maximum volume with a deterministic tie-break,
  and calculates every allocation itself.
- Orders are public from submission, so last-block sniping is possible in v1. Commit/reveal is
  explicitly out of scope.
- `SESSION_ONLY` only. No external reference is used because Robinhood Chain Chainlink feeds are
  heartbeat/deviation updates (86,400-second heartbeat, 0.5% deviation) and the historical audit
  observed only about 1–6% fresh-window coverage under the old 120-second gate.
- Swaps/additions are blocked from `openTime - auctionLead` until settlement/refund. If settlement
  is missed, the permissionless timeout/refund path reopens the ordinary pool after at most
  `auctionLead + settleTimeout` seconds of the auction window.
- A pool supports at most 512 cycles in this immutable generation; migrate to a new pool generation
  before that explicit bound. Per-cycle order capacity is 25.
- Worst-case `settle()` with 25 distinct limits measured 4,753,536 gas in a Foundry fixture. This is
  a local-EVM measurement, not a Robinhood Chain receipt. Before deployment, compare the exact
  simulation estimate on the target-chain RPC; do not treat the local number as a guarantee.
