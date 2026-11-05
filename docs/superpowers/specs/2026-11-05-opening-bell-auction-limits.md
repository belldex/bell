# Opening Bell Auction — acknowledged limits

- Escrow is custodial for the length of the window. `cancel` (before the cutoff) and `claimRefund`
  (after the timeout) are permissionless and outside every pausable path, but the funds sit in the
  auction contract meanwhile. Product copy must not claim otherwise.
- Clearing needs two-sided flow. With a one-sided book the batch degenerates into one pool swap,
  which is no better than trading today. That is a property of the mechanism, not a defect.
- The solver proposes one number, the clearing price; the contract derives every payout from it and
  verifies the price against the pool's own, so a poor proposal reverts instead of moving funds to
  the proposer.
- Orders are public from submission, so last-block sniping is possible in v1. Commit/reveal is
  explicitly out of scope.
- `SESSION_ONLY` only. No external reference is used anywhere, because the Robinhood Chain Chainlink
  feed is fresh only about 1–6% of the time (86,400-second heartbeat, 0.5% deviation). Any design
  gated on "a fresh feed at moment X" would fail the way the close anchor already does.
- Swaps are blocked from `openTime - auctionLead` until settlement or the refund timeout. On a day
  where nobody settles, that is at most `auctionLead + settleTimeout` of blocked ordinary swaps, and
  the refund path reopens them automatically.
