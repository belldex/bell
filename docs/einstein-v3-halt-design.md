# Einstein Hooks v3: halt and event windows (design and status)

Status: **the halt registry, the halt-aware policy oracle and the resume auction are built and tested, including on a mainnet fork with the whole v3 stack deployed; event windows are built at calendar and hook level; the deploy itself, a close-capture run on an intraday window and an independent review are not done.** Nothing here is deployed.

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

## Built: event windows (scripts/calendar/event-windows.mjs, 7 node tests, 2 hook tests)
An earnings window needs no new contract. It is a CLOSED leaf with its own provenance hash, carved out of the interval it overlaps, so the hook, the registry and the close-anchor capture treat it like any planned closure. `carveEventWindows` splits the source intervals, merges a window that crosses several into one leaf, and refuses overlapping, reversed or out-of-coverage windows. The carved calendar still builds a valid partition with valid Merkle proofs. If a date moves, rebuild and sign a new root; old roots stay visible.
- Hook level (V5): a two hour CLOSED leaf latches the closure with the closure budget and no blocking reason, then after the window the pool goes RECOVERING and, after a fresh observation and sixty seconds, ACTIVE. A CLOSED leaf with no captured anchor blocks instead of pricing, as for any closure.
- Override: the brief suggests a fee and caps override set in the leaf. Not built: the window uses the CLOSED fee and caps, which is the brief's own suggested value. A different override would need a new leaf field and a registry change.
- Auction at the end of a window: the opening auction arms only for CLOSED followed by PRE or OVERNIGHT. A window that ends into REGULAR or POST reopens through the closure recovery, without an auction.
- `SessionRegistry.captureClose` on an intraday window: now run. `testCaptureCloseWorksForATwoHourEventWindowInsideTheSession` captures a close anchor for a CLOSED leaf that starts mid-session and lasts two hours (anchor bound to that leaf's own boundary, stored, and valid). It uses the registry's mock sources and calendar, so it shows the code path accepts such a window, not that real sources would be eligible at that moment. The fee of 10,000 pips in a planned CLOSED still comes from the earlier fork run in a closed session, not from a swap inside a carved window.

## Built: deploy script (contracts/script/DeployHaltStack.s.sol), simulated only
Deploys HaltRegistry, BellPolicyOracleV3, an auction registry, BellAuctionFactoryModuleV2, a BellHookDeployerV3 and a BellPoolFactoryV3 beside the live Einstein v2 stack and replaces nothing; it reuses the session registry, asset registry, calendar, safety controller, HybridAuth, mode evaluator, pool manager and position manager from the environment (`BELL_HALT_*`, see the contract header). After deploying it reads every binding back (deployer to factory, oracle to registry, module to registry, auction writer, HybridAuth and role) and fails the whole run on any mismatch, including a wrong nonce count.
- Dry run on a fork of mainnet (4663) with a throwaway key and no `--broadcast`: ran, all checks passed, estimated gas about 31 million (about 0.00125 ETH at the 0.04 gwei the node quoted). The addresses it printed belong to the throwaway deployer and are not the real ones.
- The mainnet deployer held about 0.00066 ETH when last checked, which is below that estimate; it needs topping up before a broadcast.
- Not done, on purpose: no broadcast. Per the design notes, mainnet waits for an independent review, and a testnet run of the same script (chain 46630) is the step before it.
- After a broadcast the manifest status reads BROADCAST (it reads SIMULATED_NOT_DEPLOYED otherwise); verification on the explorer, the halt reporter and the keeper that calls `refreshState` and `armResume` are separate pieces of work.

## Deployed on Robinhood testnet (46630), 23 Nov 2026
The deploy script was broadcast to testnet only (manifest: `evidence/deploy/halt-stack-testnet-46630.json`, transactions: `contracts/broadcast/DeployHaltStack.s.sol/46630/run-latest.json`). Cost about 0.00024 ETH. The script's own read-back checks passed, and the bindings were read again with `cast`: oracle to HaltRegistry, deployer to the V3 oracle and the new factory, auction registry to the V2 module, module to HaltRegistry, HaltRegistry to the testnet HybridAuth with the REPORTER role.
- HaltRegistry `0xFE42C91Dd28a0501512717bC4541FCaa21458138`, BellPolicyOracleV3 `0xba229B3B018f2deEC5b3D813a466E8c24EBe6eFe`, BellPoolFactoryV3 `0x4C7E5dEc779217B3ADF7EE4E95E9665342D0008a`, BellHookDeployerV3 `0x4D69e4Ca36066C1d375DF40DA00C5cb55221CDb4`, auction registry `0x457462262a9D9be6dEE745CE4B4B786f187231A1`, module V2 `0x548B5F2dfd0F3bA0D0e4F022b8a1239FE241F6A4`.
- Not done on testnet yet: a pool through the new factory, a real hybrid-signed `halt` and `resume` (the REPORTER key needs PQ leaves on the testnet profile), a swap during the halt and the `AuctionActive` refusal. Source verification on the testnet explorer is not done either. Nothing on mainnet changed.

## Run on testnet through the deployed stack (46630), 23 Nov 2026
A pool was created through the new factory (hook `0xB81Ef919Fcc4934Db60B8284dEfec5ecaA84acc0`, ANT test token, fixture feed; `evidence/einstein/testnet-ant-pool-1795440881690.json`) and the halt proofs ran with real HybridAuth signatures (ECDSA by the REPORTER signer, SHRINCS from the local signer state, `scripts/einstein/halt-reporter.mjs`, `scripts/einstein/halt-testnet-proofs.mjs`, results in `evidence/einstein/halt-testnet-proofs.json`):
- **V3 PASS**: a halt with ECDSA only reverted on chain and changed nothing.
- **V1 PASS**: a hybrid halt (REPORTER leaf 7), the closure checkpoint, then a swap whose Swap event fee is 10,000 pips; the hook reported CLOSED. An earlier 0.3 USDG swap in the same halt reverted with `TradeCapExceeded`: the closure trade cap applies while halted (about 0.2 USDG for this pool).
- **V6 PASS**: 1 percent of the position removed while the registry said HALTED; the receipt has no log from the hook, and the hook address has the remove-liquidity bits off.
- **V2 PASS**: a hybrid resume, `armResume`, then a swap reverted with `AuctionActive`. After the five minute window the cycle stayed LOCKED until someone called `settle` (permissionless, empty book); only then did swaps reopen. A keeper has to call `armResume` after a resume and `settle` after the window.
- **V4 pending**: halt 2 was recorded and left alone; it lapses at unix 1795448256 (two hours after it was recorded). `node scripts/einstein/halt-testnet-proofs.mjs --pool evidence/einstein/testnet-ant-pool-1795440881690.json --v4-check` records PASS only if the registry has gone back to NORMAL by itself. It does not yet show a swap at the normal session fee afterwards, which needs the pool to finish its recovery with fresh session reports.
- V4 on a fork (a simulation, recorded as `V4_forkSimulation`): with time advanced 7,300 s the registry read NORMAL by itself. The hook then showed HALTED with reason bits 352 (stale report, calendar conflict, calendar missing) because the testnet calendar interval had ended and nothing keeps it or the reports fresh there, so recovery and a normal-fee swap are not shown by it.
- Two things the run taught: the pool factory's profile hash includes the policy id, which `BELL_POLICY_ID` fixes (the script now uses it with `--stack halt`); and a pool cannot be created while the stock has no active calendar interval, which on testnet needs `activate-interval` because no keeper runs there.
- Testnet only, test token, fixture feed. Nothing on mainnet changed. Not an independent review.

## Built: halt keeper (scripts/einstein/halt-keeper.mjs)
`tick` and `loop` call only permissionless functions, so the keeper holds no authority: `refreshState` when a halt has started or ended and the stored closure disagrees with the projected one, `armResume` when the registry shows the resume window, and `settle` when the auction is LOCKED. Dry run by default; `--broadcast` sends, `--network mainnet` also needs `--i-authorize-spend`. One dry-run tick on the testnet pool read the registry, hook and auction correctly (registry HALTED, hook CLOSED and latched, auction SETTLED, nothing to do). Its decisions at a halt's end and at a resume have not been run live yet; the V4 lapse is the first chance. It does not run on its own: it needs a machine or a Worker that stays up, like the ANT publisher.

## Built: halt watcher (scripts/einstein/halt-watcher.mjs, 6 node tests)
Reads `isTradingHalt` from Robinhood's pricing API (`/rhj/prices/<symbol>`) and drives the registry through `halt-reporter.mjs`. The decision is a pure function: it acts only after two consecutive observations, renews 15 minutes before the registry would lapse, resumes when the flag clears, and takes no action on a missing, failed or older-than-60-seconds quote (the registry's two hour expiry is the fail-safe). Dry run by default.
- What its source is not: Robinhood's own flag, not the exchange's halt feed, and it has no halt start time. The watcher records the time it first saw the flag as the start, so `reportDelay` measures nothing about the exchange's own delay. This answers the brief's open question for ANT only as far as that flag goes; whether Robinhood's flag follows Nasdaq's halts, and how quickly, is not known.
- Only the pure decisions and the quote parsing are tested. A live broadcast of a watcher-driven halt has not been run, and ANT was not halted when it was last read. Do not run `--broadcast` on testnet against the real quote while the V4 halt is pending: the real ANT quote says trading, so it would resume the test halt.

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
3. Done at fork level (and the deploy script is built, see below): `test/fork/EinsteinHaltRehearsal.t.sol` creates a real pool through the mainnet factory on a fork, gives the deployer's oracle address the V3 runtime code and applies a halt: the pool is ACTIVE before (mode 1), the Swap event fee during the halt is 10,000 pips (V1), and an exit during the halt works without the hook (V6). Run it with `forge test --match-contract EinsteinHaltRehearsal --match-test test_V --fork-url $RH_MAINNET_RPC_SECONDARY`. Left: a deploy script for the real stack. No new factory or deployer code is needed: `BellHookDeployerV3` already takes any `BellPolicyOracleV2`, and V3 extends it, so the stack is HaltRegistry, BellPolicyOracleV3, a new BellHookDeployerV3 pointing at it, and a new BellPoolFactoryV3. The fork test etches the code instead of deploying, so deployment wiring itself is not yet exercised.
4. Done at calendar and hook level (V5). Left: run `captureClose` and a swap inside a carved window on a fork.
5. Fork rehearsal on Robinhood testnet, then an independent review before any mainnet deploy. V7 (Sourcify exact match) has the same limit as v2: the factory builds hooks without a metadata hash.

## Open questions from the brief, still open
- Halt source: the watcher uses Robinhood's `isTradingHalt` for ANT. Still open: whether that flag follows the exchange's halts and how fast, and who runs the watcher.
- Earnings dates: who maintains them and how far ahead they are signed.

## Mainnet deploy (4663)

The v3 stack was broadcast on mainnet on 2026-11-24 on the owner's go-ahead, with the independent review dropped by the owner's decision (own review and the tests above only). Manifest `evidence/deploy/halt-stack-4663.json`, transactions `contracts/broadcast/DeployHaltStack.s.sol/4663/run-latest.json`: six transactions, all status 1, cost about 0.0005 ETH. The script's own read-back passed, and the oracle's `haltRegistry()` and the registry's `hybridAuth()` were read again with `cast`. Existing pools and contracts are untouched; only pools created through the new factory (0x86e770E2f2B7Fb9511bC5901DcdEC12E0b916a91) get halts.

Not done: REPORTER leaves for the halt registry's hybrid role are not delegated on mainnet yet, no pool exists on this factory, source verification is not done, and nothing runs the watcher or keeper on an always-on machine.

### ANT on the v3 factory (24 Nov 2026)
The first pool on the new factory is ANT/USDG (pool 0x4a956b0c…5940, 4.8 USDG seed, 49 USDG service fee). The directory (`keeper-b`) lists both factories' pools, the pool has its own Lens, and the ANT logo and address are in the web app. The price is carried by the swap, not published on chain, and the Worker keeps the calendar interval active. The full record, the one remaining dependency on the owner's computer and what is not done is in `evidence/einstein/ant-mainnet-record.json`. The halt features of this stack are deployed on mainnet but have not been used there: no halt was ever recorded and the REPORTER leaves for the halt registry are not delegated.
