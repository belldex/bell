# Einstein Hooks v3: halt and event windows (design and status)

Status: **the halt registry, the halt-aware policy oracle and the resume auction are built and tested, including on a mainnet fork with the whole v3 stack deployed; the event-window test, the real deploy script and an independent review are not done.** Nothing here is deployed.

## Naming
`BellHookV3` already exists: it is the PQ Hooks v2 template deployed on mainnet in 1fb9b06. The brief's "Einstein Hooks v3" therefore needs new contract names (`BellHookV4` and its factory), or the page and posts will describe two different things as v3.

## Built: `HaltRegistry` (contracts/src/registries/HaltRegistry.sol, 10 forge tests)
- `halt`, `renew` and `resume` are written only through HybridAuth by the REPORTER role: ECDSA and SHRINCS together. Each call spends one leaf, and `leavesUsed` and `rotationDue()` (80 percent of 4,096) are on chain.
- `phase(assetId)` is NORMAL, HALTED or RESUME_AUCTION and is decided by time alone, so no transaction is needed to expire a halt.
- Fail-safe: a halt lapses two hours after it was recorded or renewed; a lapsed halt cannot be renewed (a new halt is a new id). Resume opens a five minute RESUME_AUCTION window.
- Known gap, kept on chain: the registry stores the exchange's `startTs` and its own `recordedAt`; `reportDelay` is their difference, to publish per halt.
- Proof items it covers at contract level: V1 (state), V2 (window), V3 (ECDSA-only reverts), V4 (self-expiry). The swap behaviour inside those states needs the hook integration below.

## Built: halt-aware policy (BellPolicyOracleV3, 5 hook tests, full suite 590 passed)
The first design assumed the hook needed a new branch. It does not. `BellPolicyOracle` already had a priced "planned closed" path (used by price-protection fallback), so the oracle gained one virtual hook, `_haltedUntil`, that returns 0 in the base contract (no behaviour change; every existing test still passes). `BellPolicyOracleV3` overrides it to read `HaltRegistry.haltedUntil` for the pool's two assets.
- While halted the pool is `Mode.CLOSED`, phase CLOSED, fee 10,000 pips, closure caps, `canSwap` true after the closure is checkpointed (V1 at policy level). `BellHook` is unchanged (23,250 bytes, mask 0x2CC0), so no new hook contract, no size risk, and exits still never call the hook (V6 by construction, not yet asserted by a swap test).
- A halt on another asset does not touch the pool. A halt that expires moves the pool through the existing recovery (RECOVERING, then ACTIVE after the usual separation and fresh observations), not straight to ACTIVE.
- `refreshState` is permissionless and must be called after a halt begins or ends; a swap before that reverts with `PolicyBlocked(RECOVERY_PENDING)`. A keeper (ANT's publisher already runs one) should call it.
- A failed registry read counts as "not halted", so a broken registry cannot freeze the pool.
- The five minute resume window is priced as CLOSED by the oracle and blocked by the resume auction (see below).
- Not changed: a new pool still needs the V3 oracle in its hook, so ANT's current pool cannot adopt halts without a new pool.

## Built: resume auction (BellOpeningAuctionV2, BellAuctionFactoryModuleV2, 7 tests)
The pool-to-auction registry holds one auction per pool, and the hook already asks it `blocksSwaps` before every swap, so the resume auction lives in the same contract as the opening auction instead of a second one.
- `BellOpeningAuction` had its arming tail moved into an internal `_arm` (no behaviour change; its 20 tests still pass). `BellOpeningAuctionV2` adds `armResume()`: when the registry shows RESUME_AUCTION it arms a cycle that opens for orders at once and locks five minutes later. Escrow, uniform-price clearing and refunds are the inherited code. While OPEN or LOCKED the hook reverts swaps with `AuctionActive` (V2).
- After the window the registry is NORMAL, the oracle stops pricing the pool as halted, and the pool goes through the ordinary closure recovery. `settle` waits for the hook to report `canSwap`; a cycle that cannot settle by its deadline is refunded, like an opening cycle.
- `BellAuctionFactoryModuleV2` is the existing module with V2 auctions bound to a halt registry; the lead must be at least the five minute window.
- Fork proof, no etched code: `test/fork/EinsteinHaltStackRehearsal.t.sol` deploys HaltRegistry, BellPolicyOracleV3, the auction registry, the V2 module, a `BellHookDeployerV3` and a `BellPoolFactoryV3` over the real mainnet pool manager, session registry, calendar and asset registry; creates a pool through them; halts it (Swap event fee 10,000 pips), resumes it, arms the auction and gets `AuctionActive` on the next swap.
- Not shown on the fork: the swap after the window and settlement, because warping a fork makes the live session reports stale. The unit tests cover clearing and refund.

## Not built: what the hook has to do, and what the code says about it
These are read from the current contracts, not assumed.

1. **An unplanned CLOSED is a block today, not a priced state.** `ModePolicy` maps an unexpected CLOSED phase to `Mode.HALTED` with `canSwap = false`. The brief wants swaps priced at the CLOSED fee (10,000 pips) and CLOSED caps while halted. So a halt cannot be injected by making the calendar overlay report CLOSED: that would block swaps instead of pricing them. The new hook needs a distinct decision branch (halted: priced, CLOSED fee and caps) in `ModePolicy`.
2. **The calendar registry address is part of the pool config.** A calendar overlay that wraps `CalendarRegistry` would be a new pool, not a swap-in. That is acceptable (v3 is new contracts) but it means ANT's current pool cannot adopt halts without migrating liquidity.
3. **Event windows can reuse the calendar.** A CLOSED interval inside a trading day is already a valid leaf (`phase` 1 to 5). The fee and caps override the brief suggests (CLOSED level) is what the CLOSED phase already applies. The closure latch and anchor logic still have to be checked for an interval that opens and closes within one day; that is the open risk for V5.
4. ~~Resume auction~~ Built, see above.
5. **Contract size.** The comments in `BellPolicyOracle` say `BellHook` was five bytes under EIP-170 before logic moved to the oracle. New branches belong in the oracle and `ModePolicy`, and the hook size has to be measured after each change.

## Order of work
1. Done: `HaltRegistry` with tests.
2. Done: halt-aware oracle V3 (no ModePolicy change was needed).
3. Done at fork level: `test/fork/EinsteinHaltRehearsal.t.sol` creates a real pool through the mainnet factory on a fork, gives the deployer's oracle address the V3 runtime code and applies a halt: the pool is ACTIVE before (mode 1), the Swap event fee during the halt is 10,000 pips (V1), and an exit during the halt works without the hook (V6). Run it with `forge test --match-contract EinsteinHaltRehearsal --match-test test_V --fork-url $RH_MAINNET_RPC_SECONDARY`. Left: a deploy script for the real stack. No new factory or deployer code is needed: `BellHookDeployerV3` already takes any `BellPolicyOracleV2`, and V3 extends it, so the stack is HaltRegistry, BellPolicyOracleV3, a new BellHookDeployerV3 pointing at it, and a new BellPoolFactoryV3. The fork test etches the code instead of deploying, so deployment wiring itself is not yet exercised.
4. Event-window leaf test through `CalendarRegistry` (V5), including the one-day interval case.
5. Fork rehearsal on Robinhood testnet, then an independent review before any mainnet deploy. V7 (Sourcify exact match) has the same limit as v2: the factory builds hooks without a metadata hash.

## Open questions from the brief, still open
- Halt source: who runs the reporter and which public feed. Robinhood's pricing API already returns `isTradingHalt` for ANT (used by the ANT publisher), which is a candidate, but it is Robinhood's flag, not the exchange's.
- Earnings dates: who maintains them and how far ahead they are signed.
