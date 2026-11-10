# Opening Bell Auction Lifecycle

One `BellOpeningAuction` is deployed for each eligible USDG/stock pool. The hook resolves its address through `BellAuctionRegistry`; the registry binding is write-once.

```text
IDLE
  │ permissionless armNext(), only for adjacent CLOSED → PRE/OVERNIGHT calendar leaves
  ▼
ARMED ── auctionLead before the open ──► OPEN ── openTime ──► LOCKED
                                           │                    │
                                           │ cancel owned order  │ permissionless settle
                                           ▼                    ▼
                                          OPEN             SETTLED / claims
                                                               │
                                  deadline without settlement ──┴──► REFUNDED
```

`armNext()` verifies the current/next calendar leaves are adjacent and have the required phases. `currentStage()` projects time against `openTime`, `auctionLead`, and `cycleDeadline`. Ordinary AMM swaps and liquidity additions are blocked only while the auction's `blocksSwaps()` returns true. The v2 hook checks `AuctionActive()` before the normal hook policy path.

Orders escrow quote or base tokens from their owners. Settlement is deterministic maximum-volume uniform-price matching; it does not call PoolManager or move the AMM price. Unfilled buyers/sellers receive their residuals through claim/refund paths. `settle()` checks current hook policy before finalizing, so a halted policy can prevent settlement; the timeout/refund path remains an important review target.

Mainnet proof must include the actual `CycleArmed`, `OrderSubmitted`, `CycleSettled`/refund and claim receipts when those operations occur. The presence of an auction address alone is not proof that a cycle had participants or settled matched volume.
