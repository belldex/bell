# Architecture and Trust Boundaries

## Components

```text
User / integrator
   │ reads pool list, receipts and preflight status
   ├── BELL Worker ── public RPC / index cache
   │       ├── /pools
   │       ├── /pools/{poolId}/receipts
   │       ├── /pools/{poolId}/status → per-pool BellSwapLens
   │       └── /auctions
   │
   └── BellRouter ── Uniswap v4 PoolManager ── BellHookV2
                                            ├── BellPolicyOracle
                                            │    └── BellPolicyDependencyReader
                                            ├── BellModeEvaluator / FlowBudget
                                            ├── SessionRegistry / AssetRegistry
                                            ├── CalendarRegistry / SafetyController
                                            └── BellAuctionRegistry
                                                   └── BellOpeningAuction
```

The contracts run on Robinhood Chain Mainnet (`4663`). `BellPoolFactory` deploys the pool-specific hook, initializes the v4 pool, seeds liquidity, and activates the pool. For eligible USDG/stock pools the factory also creates and binds an auction in the same transaction. Hooks are immutable, one per pool. Auction bindings are write-once.

`BellHookV2` checks the auction guard before the inherited policy path. The inherited hook asks `BellPolicyOracle` to aggregate state and dependencies, then `BellModeEvaluator` checks the swap snapshot and actual deltas against price and flow constraints. A missing or invalid dependency must fail closed. Withdrawals remain possible because the hook does not own the v4 remove-liquidity permission.

`BellSwapLens` is a separate read-only contract instance bound immutably to one hook. It has no mutable storage, owner, or proxy. It reads the hook's pool state, budget buckets, policy, calendar, and auction binding. A Lens address is therefore recorded by `poolId` in the deployment map and served through the Worker; each new pool needs a corresponding Lens instance before the status endpoint can answer.

## Trust boundaries

- **Onchain source of truth:** PoolManager events, hook getters/state, registry state, auction contracts, Lens reads, receipts and bytecode.
- **Worker:** transports/indexes chain data and signs no swap quote in the current onchain-feed mode. Workers do not change contract policy.
- **Web UI:** presents chain or Worker data and must show the observed block/time and unavailable states. It cannot grant permissions or alter deployed contracts.
- **External services:** Blockscout, RPC providers, wallets, Chainlink feeds, explorers, and aggregators can be unavailable or return stale data. A failed read is not a pass.
- **Governance and operations:** governance/guardian roles can affect pause and configuration operations according to deployed permissions; LP withdrawal remains a PoolManager permission property.

The Worker and UI are convenience layers. A reviewer can independently read the verified hook, PoolManager events, registries and receipts from a public RPC/explorer.
