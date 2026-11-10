# Scope, Deployments, and Known Issues

## In-scope contracts

The requested review scope is:

- `BellHookV2` (each deployed hook address)
- `BellOpeningAuction` (each deployed auction address)
- `BellAuctionRegistry` and `BellAuctionFactoryModule`
- `BellPoolFactory` and `BellRouter`
- `AssetRegistry`, `CalendarRegistry`, `SessionRegistry`, and `SafetyController`
- `BellPolicyOracle`, `BellPolicyDependencyReader`, and `BellModeEvaluator`
- `BellSwapLens` (one immutable instance per live hook)
- supporting libraries that affect value movement or policy: `FlowBudget`, `ModePolicy`, `FeePolicy`, `AssetPolicy`, and auction clearing logic

Current Mainnet deployment addresses are in [`evidence/deploy/mainnet-4663.json`](../../evidence/deploy/mainnet-4663.json); verified code/bindings are in [`evidence/deploy/mainnet-4663-verification.json`](../../evidence/deploy/mainnet-4663-verification.json). Historical and current pool hooks/IDs are in [`apps/web/content/mainnet-pool-lenses.json`](../../apps/web/content/mainnet-pool-lenses.json) and the generated verifier snapshot. The Lens addresses are **not yet verified** until that map records a successful deployment receipt and full source match.

## Out of scope

- Uniswap v4 Core, PoolManager, PositionManager and Permit2 internals beyond the integration assumptions BELL relies on.
- Robinhood Chain consensus, RPC providers, sequencer, bridges, wallet software, and external token implementations.
- Cloudflare/Vercel platform internals; only BELL's Worker/UI handling and configuration are in scope.
- Financial market outcomes, oracle source licensing, token issuer actions, and LP profitability.
- Third-party indexers, wallets, terminals, and aggregators except where their integration calls BELL interfaces.

## Build and deployment record to freeze

Before an audit engagement starts, replace this section with the exact immutable record:

| Item | Release-candidate value |
| --- | --- |
| Git tag | `audit-v1` (to be created after review fixes) |
| Git commit | Record the exact commit hash at tag creation. |
| Solidity compiler | `0.8.26` (verify against build info). |
| Foundry profile/settings | Attach `contracts/foundry.toml`, remappings, optimizer and `via_ir` settings from the frozen build. |
| Chain | Robinhood Chain Mainnet, `4663`. |
| Proxy status | No BELL proxy in scope; independently confirm at every address. |
| Source match | Record `full`, `partial`, or `unverified` for every BELL address. Require full match for newly deployed Lens instances. |

## Known issues and limits to disclose

- No independent security audit has been completed as of this draft.
- `BellSwapLens.getSwapStatus` covers exact-input swaps with empty hook data and standard full-range price limits. It does not check a caller's token balance, allowance, router slippage, or arbitrary limit-price requests.
- Lens deployment and source full-match status must be recorded per pool before the public status endpoint can return a live result.
- Several Mainnet rule-test rows are still pending. Do not promote pending evidence to PASS.
- Existing auction receipt may show a bound but inactive/empty cycle. That is not evidence of a matched auction.
- The onchain feed, calendar, and external data-provider assumptions need independent validation and rights review.
- Worker/indexer snapshots can be delayed or unavailable. The chain remains authoritative; show the observation block/time and do not silently present stale snapshots as current.
- Third-party aggregator or indexer submissions do not imply acceptance or routing support.
