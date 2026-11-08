# LP proof: the live tests (A, C, D)

Test B (the historical replay) is done and lives in `research/replay`. This is the runbook for the three tests that spend real money
on Robinhood Chain mainnet (chain 4663). None of them has been run. Each one needs the owner's go-ahead on the day, and a wallet with funds.

## What is already on record

| Test | State |
| --- | --- |
| B, historical replay | Done. `research/replay/results.csv`, 60 rows, README and charts. |
| D, rule tests | Done on the **Elysium testnet** (5 real transactions, in `deployments/rule-tests.json`). Mainnet entries are PENDING. |
| C, Opening Bell with real participants | One full auction cycle settled on the **Elysium testnet** (`evidence/deploy/elysium-testnet-tests.json`). Mainnet is not run. |
| A, plain pool against BELL pool, live | Not run. |

A testnet transaction is a rehearsal. It must never be shown as a mainnet result, and `rule-tests.json` keeps the two apart.

## Test C: Opening Bell live (Monday 9 Nov)

Needs: two team wallets (one buyer with USDG, one seller with the stock token) and community invitees; the auction armed for the Monday
open (the keeper arms it during CLOSED when the next leaf is PRE).

1. Before the open, check the auction is armed: `node scripts/auction-cli/bell-auction.mjs` (stage ARMED or OPEN).
2. Inside the ten-minute window before the open, each team wallet submits one order: the buyer a quote-funded buy, the seller a base-funded sell. Submit nothing for anyone else.
3. After the open, once the hook has been checkpointed twice 60 seconds apart, call `settle()`.
4. Record: clearing price, order count, matched volume and the settle transaction. Write them into the evidence file and publish.

## Test D: rule tests on mainnet

Run each against one mainnet BELL pool and save the transaction hash into `deployments/rule-tests.json` (mainnet entry), by hand from the explorer, never from a draft:

1. Swap above the trade cap: expect `TradeCapExceeded`.
2. Swap in a session with no close anchor: expect `PolicyBlocked`.
3. Swap while the auction is open: expect `AuctionActive`.
4. Withdraw while CLOSED: expect success.

A reverted swap is recorded as a reverted transaction (simulate first, then send with a manual gas limit so it lands on chain).

## Test A: plain pool against BELL pool, with the team as the arbitrageur

Same pair in two pools, for example TSLA/USDG, small liquidity ($50 to $200 each): one standard v4 pool with a fixed 0.30% fee and no hook, and one BELL v2 pool with the auction.
Snapshot on Friday 13 Nov, run on Monday 16 Nov at the open from a separate, publicly labelled wallet, withdraw both positions and publish every transaction.
Announce it openly: "We played the arbitrageur against our own pools." Do not invite the public to fund either pool.

**Not built yet, so it blocks this test:**
* Tooling to create and seed a hookless v4 pool and to swap in it on mainnet. The existing mainnet scripts (`mainnet-swap.mjs`, `create-testnet-pool.mjs`) target BELL pools through `BellRouter`. The replay harness (`contracts/test/research/WeekendReplay.t.sol`) has the Foundry version of the same steps.
* The arbitrage script itself, to be published. It should read both pool prices and the open price, simulate every swap, and send only with an explicit `--broadcast` flag.

Both are quick to write, but they should be rehearsed on the Elysium testnet first, so they need a plain pool there too.

## What the owner has to provide

* Funded wallets for each test and which wallet plays which role. Private keys stay in `contracts/.env`, never in chat.
* The pair for test A.
* A clear yes on the day for each mainnet send.
* The decision on when `/proof` goes public: the LP Proof section shows replay numbers and should wait until these tests have run.
