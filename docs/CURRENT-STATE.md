# BELL — Current State (Mainnet snapshot 2026-10-31)

Single source of truth. Mainnet claims below are checked against deployment evidence and live chain reads.

## Current Mainnet — Robinhood Chain 4663

The always-available policy implementation was deployed on 2026-10-31. Four CREATE transactions confirmed
in blocks `102445453` and `102445459`; total receipt cost was `0.000447757730788 ETH`. The production factory is
`0x5bf1aa3913c59215ea90a3fb9482bf6f32d8152b`, hook deployer
`0x0f3c8be6e701b4466e0181cd6cde0814880cbc9e`, policy oracle
`0xc0f60f0aa9ef9f6eaca1a33f25d39575be80bf1c`, and mode evaluator
`0x59599f115df4588de4a17e195a28c5f7fa6930be`. Factory profile hash:
`0xbc951f9a7e952b147dfbcab956f4b45aff23c55c69b264d7849858898d1d0265`. The registries, PoolManager,
PositionManager, WETH, fee token, and router are reused from the verified Mainnet deployment. Verification is
recorded in `evidence/deploy/mainnet-4663-verification.json` at block `102445470`.

Two pool classes are available. `PRICE_GUARDED` uses its independent reference and price band while those
inputs are valid; when required stock inputs or references are unavailable, including when no usable close
anchor exists, policy marks the pool as AMM-only fallback, removes reference prices, charges the 1% fallback
fee, and applies the existing strict caps (one fifth per trade and one quarter of the rolling cap).
`SESSION_ONLY` always uses the AMM price and does not require stock-feed freshness or a close anchor. Both
classes still enforce asset identity/admission, calendar validity, pause state, pool lifecycle, actual
transaction bounds, and available liquidity. Fees and caps do not guarantee a maximum loss; price divergence,
slippage, liquidity depth, and arbitrage remain economic risks.

Cloudflare Worker `https://bell-keeper-b.asysyifaq25.workers.dev` is deployed with the new factory and a scan
start block of `102445470` (version `856cdc23-0c51-41a7-94ae-99c2590de48d`). `/status` and `/pools` return
Mainnet data. `/quote` returns 410 by design: swap estimates are simulated through the live BellRouter and
pool policy is read from the hook; the Worker does not sign quotes. The latest `/pools` read returned no
pools, so no Mainnet liquidity position or swap exists yet. The app supports pool creation, seeding, and
swaps; the first live pool still needs its creator to choose seed amounts and submit the wallet transactions.

Deployment and verification records: `evidence/deploy/mainnet-4663.json`,
`evidence/deploy/mainnet-4663-verification.json`,
`contracts/broadcast/UpgradeMainnetFactory.s.sol/4663/run-latest.json`,
and `workers/keeper-b/wrangler.jsonc`.

## Historical Mainnet snapshot — previous Chainlink policy

The following research and production snapshot predates the current always-available policy deployment. Its
feed freshness conclusions describe the earlier policy and must not be used to claim that the current
`SESSION_ONLY` or fallback classes require a fresh Chainlink report.

Historical feed cadence was audited from up to each stock feed's latest 100 onchain rounds at block
`102291723` (`2026-10-31T04:43:45Z`); the complete report is
`evidence/deploy/mainnet-4663-session-feed-history.json`.
Rounds were observed during PRE, REGULAR, POST, and OVERNIGHT for all three stocks, but observed round
availability is not the same as a fresh quote: estimated time coverage under the deployed 120-second gate
was about 1.3–5.6% under a 120-second freshness window in session groups with enough adjacent rounds to
estimate it. This is an upper bound for REGULAR, where the effective limit is 60 seconds; most sampled
within-session gaps were far longer than 120 seconds. This limited historical sample therefore does not
establish continuous 24/5 swap availability. The onchain Data Feed path needs no separate keeper update
transaction, but swaps and pool creation fail closed when the active session's effective freshness limit
is exceeded.

Provider research as of 2026-10-31: Chainlink documents Data Feeds as heartbeat/deviation-triggered updates,
not streaming, and warns that some heartbeats last several hours
([Data Feeds overview](https://docs.chain.link/data-feeds/overview)). Data Streams gives sub-second reports,
but requires API credentials and subscription billing; Chainlink's published free tier ended on 2026-09-01
([credentials](https://docs.chain.link/data-streams/tutorials/ts-sdk-fetch),
[subscription billing](https://docs.chain.link/data-streams/tutorials/evm-onchain-report-verification),
[free-tier notice](https://docs.chain.link/changelog)). Chainlink announced 24/7 RWA pricing on 2026-10-29;
closed-market prices are blended from perp venues, and the post says to contact Chainlink for integration,
so no public entitlement or price is established
([Chainlink 24/7 announcement](https://chain.link/blog/introducing-chainlink-24-7)). Robinhood documents a
15-second-cache `/prices/{symbol}` API, but its public terms broadly limit incorporating its Services and
materials into applications; this project has not switched production feeds to that API without explicit
permission ([API docs](https://docs.robinhood.com/chain/stock-token-apis/),
[terms](https://docs.robinhood.com/chain/terms-of-service/)).

Alternative-provider check on 2026-10-31: Pyth Core and Pyth Pro verifier contracts are deployed on
Robinhood Chain, and Pyth Core currently charges no EVM update-verification fee. However, Pyth's own
sponsored-push-feed list does not include Robinhood Chain, so an app would need to obtain signed stock
updates and submit them with transactions. Pyth Pro's API key and feed access require a paid service plan
for production; the free plan is view-only with no API access or redistribution rights. The listed Starter
plan is $500/month and covers crypto, while equities are listed under Pro starting at $2,500/month; Pyth
Indices' 24/7 data has custom pricing. A free trial key is available for evaluation but does not grant
production redistribution rights. This does not provide a free production source for AAPL/NVDA/TSLA.
Sources: [Pyth contract addresses](https://docs.pyth.network/pro/contract-addresses),
[sponsored feeds](https://docs.pyth.network/pro/sponsored-feeds),
[on-chain fees](https://docs.pyth.network/pro/on-chain-fees),
[Pyth pricing](https://app.pyth.com/products),
[Pyth API key](https://docs.pyth.network/pro/acquire-api-key).

A fresh, read-only Data Streams API check at `2026-10-31T04:57:50Z` confirms credential A still
authenticates, but its authorized feed list is empty; the configured credential B variable has no value.
No Robinhood AAPL, NVDA, or TSLA stream is available to this account, and no subscription was created.
Evidence: `evidence/runtime/chainlink-entitlement-live-2026-10-31.json`. Chainlink's 24/5 U.S. Equities
Streams provide separate Regular, Extended, and Overnight reports, selectable across the
PRE/REGULAR/POST/OVERNIGHT calendar, but the live report path cannot be activated on this account until
access is provisioned ([24/5 Streams release](https://docs.chain.link/changelog/245-us-equities-streams-now-available),
[Robinhood Chain verifier](https://docs.robinhood.com/chain/data-streams/)). The free onchain Data Feed
remains configured for all sessions and needs no keeper transaction; its updates cannot satisfy BELL's
120-second onchain freshness gates reliably, as measured in the historical round audit above.

The live Chainlink reference directory was also checked at `2026-10-31T05:00:06Z`. It lists exactly
one 24/5 onchain Data Feed proxy for each of AAPL, NVDA, and TSLA, each with `marketHours=us_equities_24/5`,
an 86,400-second heartbeat, and a 0.5% deviation threshold. The same proxy is therefore correctly wired
through BELL's phase-scoped adapters; there are no separate PRE/REGULAR/POST/OVERNIGHT Data Feed proxies
to switch among. This push feed may go many minutes or hours without a new round, so BELL's independent
120-second execution guard intentionally fails closed in those gaps. Snapshot:
`evidence/runtime/chainlink-robinhood-feed-directory-2026-10-31.json`.

Fresh production read at `2026-10-31T05:18:49Z` confirms the Worker reads Mainnet at block
`102311380`; all three assets are CLOSED with `closed-anchor-missing`, and `/pools` is empty at block
`102311401`. Feed ages were 34,056 seconds for AAPL, 33,409 for NVDA, and 36,579 for TSLA against the
120-second adapter limit. The effective active-session thresholds now match the policy in Worker code:
REGULAR is 60 seconds, PRE/POST/OVERNIGHT are capped at 120 seconds by the adapter. The currently closed
market does not exercise these active-session code paths on production; they are covered by the 70-test
Worker suite. The previous 24/5 close-capture window is no longer open, so its anchor
cannot be backfilled now. The Worker has a transaction key and boundary cron, but `captureClose` requires
the phase adapter to pass the 120-second gate and the direct adapter to pass its separate 600-second
gate. Friday's latest sampled rounds were 15:51 ET for AAPL, 16:02 ET for NVDA, and 15:09 ET for TSLA;
the next weekly CLOSED boundary was 20:00 ET, when those inputs were hours old. That feed cadence cannot
produce a valid close anchor under the current strict policy. Live snapshot:
`evidence/deploy/mainnet-4663-live-status-2026-10-31T0518Z.json`.

### Pre-Chainlink migration snapshot (superseded)

The following block documents the deployment that existed before the migration above. Its signed
Yahoo quote Worker and old registry addresses are not the active Mainnet configuration.

## Testnet history — REGULAR rehearsal trace 2026-10-28

**The latest REGULAR rehearsal pool was created, received one swap, and passed acceptance 82/82.** The
price came from a fresh Yahoo REGULAR quote through the regular adapter; the asset/token is a rehearsal
fixture, not an official Robinhood token. This is a testnet snapshot, not a claim of ongoing health.
Earlier deployments are documented separately.

The calendar leaf is now built for whichever session Yahoo and chain time actually agree on, so the
rehearsal no longer depends on being run before 13:30 UTC. Every calendar root, interval, report, and
health write is simulated before broadcast and read back from chain afterwards.

---

## 1. Ringkasan

- **Yahoo REGULAR rehearsal verified** through direct and regular-phase reports matching the active REGULAR calendar leaf.
- **One testnet swap on the latest REGULAR pool**, with its committed budget recorded (see table below).
- **REGULAR phase acceptance passed 82/82**; this checks one snapshot and does not claim ongoing pool health.
- **The frontend has a live swap path** (`LiveSwapPanel`): reads on-chain policy, approves, submits to
  `BellRouter`, and displays the result. It appears only when `NEXT_PUBLIC_BELL_LIVE_HOOK` is set.
- 355 forge tests, 298 node:test tests, and all gates passing.

This historical testnet snapshot does not describe the current Mainnet state. The testnet keeper remains
separate from the Cloudflare Mainnet Worker. Treasury handover is still outstanding.

---

## 2. Swap testnet

| Pool/deployment | Tx | Block | Spent | Received | Gross before | Gross after |
|---|---|---|---|---|---|---|
| Latest REGULAR rehearsal pool `0xd32bb2ce…` / hook `0x42708E40…` | `0xf9161400…` | 144311749 | 5 | 3 | `[0, 0]` | `[5, 3]` |
| Earlier PRE rehearsal pool `0xa18cd3ff…` / hook `0xcE7f7306…` | `0x62b6060e…` | 144182744 | 5 | 3 | `[0, 0]` | `[5, 3]` |
| Earlier REGULAR rehearsal pool `0xc2b56af3…` / hook `0x549f0C66…` | `0xca40693c…` | 144051118 | 5 | 3 | `[0, 0]` | `[5, 3]` |
| Previous pool `0x01ca38d9…` / hook `0x60ebf708…` | `0x75243421…`, `0x1692a6e8…`, `0x9c846c76…` | 143926986–143938848 | 5, 7, 9 | 3, 5, 7 | tracked separately | rolling window rotated |

The latest deployment's swap was confirmed by a successful receipt and gross `[5,3]`. Earlier pool evidence
proves rolling-window rotation on the old deployment; it does not prove rotation for the latest pool.

The latest swap was submitted while on-chain policy reported `canSwap=true`, `reasonBits=0`; the transaction
succeeded and gross changed from `[0,0]` to `[5,3]`. REGULAR acceptance passed afterward. Health/policy is
time-sensitive and may expire after the keeper stops; do not infer that the pool remains tradable from this
snapshot. No Yahoo phase was ever relabeled to fit a calendar.

Note: while the pool is in guarded mode the effective per-trade cap is one fifth of the configured cap, so a
5-unit rehearsal swap only fits after the pool returns to ACTIVE. The earlier `TradeCapExceeded` revert was
that guard, not a budget or allowance bug.

---

## 3. Price keeper

```bash
# Yahoo rehearsal, single tick (dry run)
node scripts/deploy/keeper-price.mjs

# Yahoo rehearsal, broadcast one tick; --gas avoids RPC estimation limits
node scripts/deploy/keeper-price.mjs --broadcast --gas=900000

# Continuous mode
node scripts/deploy/keeper-price.mjs --broadcast --gas=900000 --loop --interval=30
```

Without `--broadcast`, the keeper only prints what it would do—no transaction is sent.

Perilaku penting:
- **A closed Yahoo market is normal**, not a crash. It is reported as `STALE_SOURCE`; nothing is marked fresh
  or considered healthy.
- `--offline` keeps the pool alive for rehearsal while the market is closed.
- Each tick writes `evidence/runtime/keeper-price-last.json`, so monitoring can read one small file instead
  of querying the chain.

The keeper selects a wire from the on-chain calendar phase: REGULAR uses the regular adapter, PRE/POST use
the extended adapter, and overnight uses the overnight adapter. Yahoo PRE is accepted only during calendar
phase PRE; phase mismatches and stale quotes are still rejected. Use `--gas=900000` if the RPC rejects the
report gas estimate under the allowance limit.

```
06:58:30  canSwap=false   (recovery pending)
06:58:48  canSwap=true
06:59:05  canSwap=true
06:59:23  canSwap=true
```

---

## 4. Frontend swap nyata

`apps/web/components/swap/LiveSwapPanel.tsx` + `apps/web/lib/live-swap.ts`.

What it does:
1. `readLivePool(hook)` → reads `poolKey`, `configHash`, and `getPolicy()` directly from the chain.
2. If `canSwap === false`, displays "not currently tradable" and **does not build a transaction**.
   The contract makes this decision, not the UI.
3. Approval is a separate, visible step.
4. `buildSwapRequest` applies slippage to `limitAmount` (exact-input protects the output floor).
5. Submits to `BellRouter.swap`, waits for the receipt, and checks on-chain status.
6. Maps reverts to actionable messages: `PolicyBlocked`, `SlippageExceeded`, `DeadlineExpired`, wallet
   rejection, and insufficient funds.

The panel appears only when `NEXT_PUBLIC_BELL_LIVE_HOOK` is set, leaving preview mode unchanged.

New guard tests (`apps/web/test/homepage.test.mjs`) ensure:
- `functionName: 'swap'` and `functionName: 'approve'` are present in the live path;
- `readLivePool` is called (policy is read on-chain, not from a fixture);
- the panel gates on `pool.canSwap` rather than fabricating success.

---

## 5. Contract addresses (chain 46630)

| Contract | Address |
|---|---|
| SafetyController | `0xcc73fc8265630a7b7873028f77584037273d70c2` |
| AssetRegistry | `0x3b71543bd71b9d4c9678216d338611236a37b380` |
| CalendarRegistry | `0x0c7a4044f2caf793b2062920c12baf8b33641e9c` |
| SessionRegistry | `0x1de6199618ddb2b5fdb869113e4b906628db168e` |
| PoolManager | `0xc353daf2a37aca96ea468239d973a76020dea059` |
| PositionManager | `0x9116ff2aa7a41b60b478ae3ecd8b9b0466a97874` |
| BellHookDeployer | `0xff8734ef77284d61e11a27146e939bc0bd8bf10a` |
| BellPoolFactory | `0x4b22251105e65d76366d27099ac7c5097b63faf5` |
| WETH fixture | `0x45b4bf15c1cb91442a62620441dbc0b6486dfebe` |
| BellRouter | `0x1b91eadba66747430188672bd7bce0cc3eef6c85` |
| mBELL fee token | `0xe683f39fbaf9ced50c0ac2fd56c2032c58d82150` |
| AAPL rehearsal stock (previous pools) | `0xb82815f01a3c9034fbf06d05a99f0beb862d705a` / `0x3c2470c719522a44ade6a9c1f4fdf653e1d3295a` |
| Yahoo verifier | `0x20a066123c260bc6c5253f75e261c5056fde4bea` |
| Direct adapter (latest stock) | `0x9bd2473aa35eff6bd4db9bea9518b970f2375def` |
| Regular adapter (latest stock) | `0x4dc7ecdf11e7457116471153bc8b247dd62e7c0c` |
| Extended adapter (latest stock) | `0x93b1d074fa3bf7d5c7f2c255e7d962df8868e9c3` |
| **Latest REGULAR rehearsal pool hook** | `0x42708e4001b85fcbd5e6d5e5c9fe197cfd44acc0` |
| **Latest REGULAR rehearsal pool ID** | `0xd32bb2cef93c6d9a612f362cfccc20c2549e4bf73887e6bf8cd0fb778413b82b` |
| Earlier PRE rehearsal pool hook | `0xce7f73065907ea42ea8d0f0b389fa0d4b82dacc0` |
| Earlier PRE rehearsal pool ID | `0xa18cd3ffdd044195a3985ade3a3330c40de6bd0353373a4c5ac6e74dfae7a82c` |
| Previous REGULAR rehearsal pool hook | `0x549f0c6657d9e39a034f7524e501d218b2c6acc0` |
| Previous REGULAR rehearsal pool ID | `0xc2b56af343d2bcf1d9729517223fed8b6c2ec16f748e25a2d281c21c49e2e0ea` |
| **Latest rehearsal stock** | `0x71711fbe3c0861975eea42f4fc4f0f96454c0f23` |

---

## 6. How to rerun the full flow

```bash
# deploy stack
node scripts/deploy/deploy-testnet.mjs
node scripts/deploy/deploy-testnet-stock-and-adapters.mjs
node scripts/deploy/admit-testnet-assets.mjs
node scripts/deploy/setup-calendar-and-price.mjs

# create the pool
node scripts/deploy/create-testnet-pool.mjs

# start the keeper (leave it running); use --gas=900000 if the RPC rejects report gas estimation
node scripts/deploy/keeper-price.mjs --broadcast --gas=900000 --loop --interval=30

# swap at any time while on-chain policy reports canSwap=true
node scripts/deploy/swap-live-pool.mjs --amount=-5

# phase-aware acceptance (1 = PRE, 2 = REGULAR, 3 = POST)
BELL_EXPECTED_CALENDAR_PHASE=2 node scripts/deploy/final-testnet-acceptance.mjs
```

---

## 7. Test

355 forge test (28 suite, 2 invariant 100k run), 298 node:test, 45+18 reference, 15 Deno,
6 keeper-b tests, compilation of 169 source files, `abi:check`, `evidence:check`, and `check:secrets` — all passing.
Web: typecheck bersih, build 7 route, test web 6/6.

---

## 8. Remaining work

| Hal | Kenapa |
|---|---|
| Mainnet | Requires real ETH and a funding decision |
| PRICE_GUARDED | Requires an admitted reference pair and `referenceMode` mapping |
| Treasury handover | Treasury is still `0x…dEaD`; a replacement address is required |
| Keeper in Supabase cron | Currently runs locally; not yet installed in pg_cron |
| Yahoo data rights | Still `NOT_VERIFIED` in `config/sources/rights-status.json` |
