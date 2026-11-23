# Einstein Hooks v3: halt and event windows (design and status)

Status: **the halt registry is built and tested; the hook integration is designed and not started.** Nothing here is deployed.

## Naming
`BellHookV3` already exists: it is the PQ Hooks v2 template deployed on mainnet in 1fb9b06. The brief's "Einstein Hooks v3" therefore needs new contract names (`BellHookV4` and its factory), or the page and posts will describe two different things as v3.

## Built: `HaltRegistry` (contracts/src/registries/HaltRegistry.sol, 10 forge tests)
- `halt`, `renew` and `resume` are written only through HybridAuth by the REPORTER role: ECDSA and SHRINCS together. Each call spends one leaf, and `leavesUsed` and `rotationDue()` (80 percent of 4,096) are on chain.
- `phase(assetId)` is NORMAL, HALTED or RESUME_AUCTION and is decided by time alone, so no transaction is needed to expire a halt.
- Fail-safe: a halt lapses two hours after it was recorded or renewed; a lapsed halt cannot be renewed (a new halt is a new id). Resume opens a five minute RESUME_AUCTION window.
- Known gap, kept on chain: the registry stores the exchange's `startTs` and its own `recordedAt`; `reportDelay` is their difference, to publish per halt.
- Proof items it covers at contract level: V1 (state), V2 (window), V3 (ECDSA-only reverts), V4 (self-expiry). The swap behaviour inside those states needs the hook integration below.

## Not built: what the hook has to do, and what the code says about it
These are read from the current contracts, not assumed.

1. **An unplanned CLOSED is a block today, not a priced state.** `ModePolicy` maps an unexpected CLOSED phase to `Mode.HALTED` with `canSwap = false`. The brief wants swaps priced at the CLOSED fee (10,000 pips) and CLOSED caps while halted. So a halt cannot be injected by making the calendar overlay report CLOSED: that would block swaps instead of pricing them. The new hook needs a distinct decision branch (halted: priced, CLOSED fee and caps) in `ModePolicy`.
2. **The calendar registry address is part of the pool config.** A calendar overlay that wraps `CalendarRegistry` would be a new pool, not a swap-in. That is acceptable (v3 is new contracts) but it means ANT's current pool cannot adopt halts without migrating liquidity.
3. **Event windows can reuse the calendar.** A CLOSED interval inside a trading day is already a valid leaf (`phase` 1 to 5). The fee and caps override the brief suggests (CLOSED level) is what the CLOSED phase already applies. The closure latch and anchor logic still have to be checked for an interval that opens and closes within one day; that is the open risk for V5.
4. **Resume auction.** The auction runs from the hook's bell start. It needs a trigger from the halt registry's `RESUME_AUCTION` state, with the same escrow and clearing rules. This is the largest piece and the part most likely to need a new auction hook entry.
5. **Contract size.** The comments in `BellPolicyOracle` say `BellHook` was five bytes under EIP-170 before logic moved to the oracle. New branches belong in the oracle and `ModePolicy`, and the hook size has to be measured after each change.

## Order of work
1. Done: `HaltRegistry` with tests.
2. `ModePolicy` halted-priced branch plus oracle input, with unit tests for the matrix (halted, resume auction, expiry, closure latch).
3. `BellHookV4`, its deployer and factory; exit path unchanged (mask 0x2CC0), proving V6 by test.
4. Event-window leaf test through `CalendarRegistry` (V5), including the one-day interval case.
5. Fork rehearsal on Robinhood testnet, then an independent review before any mainnet deploy. V7 (Sourcify exact match) has the same limit as v2: the factory builds hooks without a metadata hash.

## Open questions from the brief, still open
- Halt source: who runs the reporter and which public feed. Robinhood's pricing API already returns `isTradingHalt` for ANT (used by the ANT publisher), which is a candidate, but it is Robinhood's flag, not the exchange's.
- Earnings dates: who maintains them and how far ahead they are signed.
