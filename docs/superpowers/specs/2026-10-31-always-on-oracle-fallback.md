# Always-on Swaps with Oracle Fallback

## Goal

Allow stock pools created through BELL Mainnet to accept swaps through PRE, REGULAR, POST, OVERNIGHT, and CLOSED periods, including when a stock feed is stale, while preserving oracle price protection when its inputs are valid.

## Approved behavior

- `PRICE_GUARDED` uses its admitted independent reference prices and existing price-band checks while both reference legs are valid.
- If either required stock/reference input becomes stale or unavailable, a `PRICE_GUARDED` pool remains tradable in an explicitly reported AMM-only fallback. It uses the pool's current AMM price path, the maximum existing LP fee (10,000 fee units / 1%), and the strictest existing flow limits (one fifth of configured per-trade caps and one quarter of configured rolling-window caps). The fallback is not described as price-protected.
- `PRICE_GUARDED` pools use the same AMM-only fallback during a calendar-proven CLOSED period. Missing close anchors do not block that fallback.
- `SESSION_ONLY` remains AMM-only at all times and does not depend on stock-feed freshness or a close anchor. It keeps session fees and the existing session/guarded flow limits.
- Calendar, asset registry identity, token/pool safety pauses, hook lifecycle, liquidity availability, and transaction validity remain enforced. Missing/invalid calendar data maps to the most conservative known fee/limits where possible; malformed registry or pause state fails closed.
- Public policy/status surfaces identify whether oracle price protection is `active`, `fallback`, or `not-applicable`. A fallback never carries a misleading healthy reference price.
- The UI keeps both pool classes available, explains their price-protection behavior, and displays fallback status before a swap is signed.
- UI and landing copy must not say stale feeds block swaps for these classes.

## Safety properties

- Oracle fallback does not claim a maximum financial loss. Fee and flow caps limit execution rate and size only.
- Emergency pool/token pauses remain effective in every mode.
- Fresh `PRICE_GUARDED` swaps retain their current independent price-band and price-path enforcement.
- Stale-reference fallback must not synthesize or report a fair price.
- Existing pools are absent from the recorded Mainnet directory, so the rollout can replace the factory/hook template before users create pools; confirm that remains true before broadcasting.

## Deployment boundary

The policy oracle, hook, mode evaluator, and factory are immutable deployment artifacts. Any bytecode or policy ABI change requires a new factory/hook template deployment and production configuration update. No Mainnet transaction is sent until local contract, app, Worker/API, ABI, and deployment-preflight checks have passed.

## Acceptance

1. Fresh `PRICE_GUARDED`: `canSwap=true`, protection status active, normal price-band rejection still works.
2. Stale/missing stock feed in an open phase: `canSwap=true`, protection status fallback, maximum fee and strictest caps apply, no independent reference is exposed, AMM price-path checks remain internally consistent.
3. CLOSED with no anchor: `canSwap=true` in fallback for `PRICE_GUARDED`; `SESSION_ONLY` remains tradable; finite rolling/episode accounting cannot be bypassed.
4. Valid pause, bad token identity, malformed calendar/pause registry, uninitialized pool, or empty/invalid transaction still blocks.
5. Create UI retains both classes; swap UI shows the protection state and does not claim stale feed protection.
6. Mainnet Worker pool/policy responses and deployed factory/hook addresses match the new implementation; `/pools` and `/status` are checked after deployment.
