# BELL Pull Oracle Design

## Goal

Keep AAPL, NVDA, and TSLA available in the full pool matrix while removing routine Yahoo report transactions when no one is trading.

## Current constraint

Mainnet BELL stock health is built from a reporter-signed direct sample, a reporter-signed phase sample, and a stored health checkpoint. Deployed policy accepts reports only while their observation age is below 120 seconds. Pool policy also keeps a 60-second observation-separation rule when recovering after a stale interval. These checks remain in force; the pull design must not extend report age or bypass recovery.

## Design

The Cloudflare Worker becomes a read-and-sign quote service for Mainnet. `GET /quote?symbol=AAPL|NVDA|TSLA` reads the chain and active calendar phase, fetches Yahoo's chart quote, verifies phase and freshness, and returns an ABI-friendly update bundle with decimal strings for integer fields. It does not broadcast or pay gas, and the transaction private key is not required in pull mode.

`SwapRequest` carries optional signed updates for the stock assets in that pool. Each `OraclePullUpdate` contains `assetId`, `directSample`, `directSignature`, `reports`, and an optional `closeBoundaryHash` (zero when unused). `BellRouter` binds the payload into its request hash and forwards it as Uniswap v4 `hookData`. `BellHook` validates that updates name only the pool's stock assets, applies them through a new atomic `SessionRegistry` helper, then evaluates its existing policy. The direct adapter and report verifier remain the source of truth for signatures, phase, freshness, and replay protection.

Each pool keeps using its existing token pair and class. A stock/counterasset pool carries one stock update; a stock/stock pool carries both stock updates. WETH/USDG Chainlink reference adapters remain read-only inputs and do not need Yahoo reports.

The pull update may also carry the canonical hash of the upcoming CLOSED calendar leaf. During the registry's existing five-minute pre-close window, the Hook asks SessionRegistry to capture the close anchor after applying the fresh reports, in the same transaction. The registry validates the leaf and source inputs as it does today. This is opt-in and caller-funded; if nobody submits an update in that window, the existing closed-phase policy stays fail-closed because no valid close anchor exists. There is no background close-anchor keeper in this design.

The hook exposes a permissionless prepare path that applies signed reports, refreshes stock health, and checkpoints recovery without attempting a swap. Clients use it when cached health has expired; if recovery requires a second observation, they prepare again after the existing 60-second separation. Ordinary swaps can carry fresh updates atomically while the pool is already in an executable state. No timer or relayer is required to keep idle pools fresh. On-chain close anchors are refreshed only when a caller opts into capture during the existing pre-close window.

After a successful swap settled in ACTIVE mode, the Hook advances its prior-health validity deadline from that swap's exact policy snapshot. The report and checkpoint write share the swap transaction, so failed swaps roll back both. This preserves continuity for active users who keep supplying fresh updates; a real stale gap still enters the existing recovery path and cannot be cleared inside a reverting swap.

## Veil reference

Veil's routers demonstrate transporting arbitrary bytes through `PoolManager.swap` to a hook, where the hook validates a caller-bound signature. Veil does not implement price-oracle pull updates. BELL uses the transport pattern only; its report validation continues to rely on BELL's reporter signatures, registries, and policy checks.

## Safety and compatibility

- Report maximum age remains 120 seconds; source phase must match the on-chain calendar.
- Reports remain domain-bound to chain 4663, the verifier, and pinned source configuration.
- SessionRegistry replay/high-water checks remain active for submitted updates.
- A stale pool does not become tradable from one fresh quote; the existing recovery separation remains.
- Close-anchor capture remains caller-funded and time-limited; missing the five-minute window leaves closed-phase swaps unavailable under the existing fail-closed policy.
- Pool policy still evaluates every configured stock leg. Full AAPL/NVDA/TSLA support is retained.
- Existing Mainnet contracts are immutable. Pull-enabled code requires deploying a new SessionRegistry, Router, Hook template, and corresponding policy/oracle dependencies, then creating pools with the new Hook. The existing AssetRegistry, CalendarRegistry, admitted assets, Yahoo verifier/adapters, and Chainlink reference feeds may be reused only after deployment wiring is verified; the new SessionRegistry starts with no stored reports/health and must be prepared on demand.
- This design removes scheduled Mainnet writes. Each trade or explicit prepare call still pays gas for any report updates it submits.

## Acceptance criteria

1. A configured symbol can receive a fresh direct and phase-signed quote bundle without any transaction being sent.
2. A pull bundle for an asset outside the pool is rejected.
3. Invalid signatures, wrong phase, stale observations, and replayed reports are rejected by the same on-chain validation path as push reports.
4. Router-originated nonempty hook data is accepted only in the documented BELL payload format and is bound across before/after swap callbacks.
5. A fresh update cannot bypass the existing 60-second recovery observation separation.
6. AAPL, NVDA, and TSLA remain configurable; stock/stock pools require valid updates for both stock legs.
7. No deployment script in this implementation broadcasts to Mainnet.
8. Repeated successful ACTIVE swaps with fresh updates keep the health-continuity checkpoint current; a stale gap still needs separate preparation and the 60-second advanced observation.
