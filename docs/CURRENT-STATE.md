# BELL — Current State (Mainnet snapshot 2026-10-31)

Single source of truth. Every claim is backed by a transaction or on-chain state.

## Mainnet snapshot — Robinhood Chain 4663

The 11-contract protocol stack is deployed and verified at block `101806323` (manifest hash
`0xf4a8e9cd8baeca87530d7ab52b45c58dd2bff08123f1097e5348f06dd46a3bb4`). The Yahoo verifier and
AAPL/NVDA/TSLA adapters, Chainlink reference adapters, WETH/USDG and all three stock admissions, and
their calendars are active. MEME (`0x385F4f8ae47651ce5F58F5265395a669f8281e18`) was separately reviewed and admitted to AssetRegistry for `SESSION_ONLY` use. Admission transactions: queue `0x1661ba1d4f352553d5b1a4ec8020b8e51d0aa9e1503bd93a81d6c6f2b59bfec1`, activation `0x9eefcc4c0c93c4c645d6795fbde4c870a136871af689d8ade32bd97f07b6b0c8`; descriptor `0x42c37e7e9a00925ae632b808beaec5d21a822eef271cd35f27935ca9a45bd46f`. This is an admission review, not a security audit or fair-value assessment. MEME has no independent price source and no `PRICE_GUARDED` option. See `evidence/deploy/mainnet-4663-counterasset-meme-review.json` and
`evidence/deploy/mainnet-4663-verification.json`, and related evidence files.

The Cloudflare pull quote Worker is deployed at `https://bell-keeper-b.asysyifaq25.workers.dev`
(version `de1f0d82-98ef-4963-8ad8-ca94915806c0`). `/quote?symbol=AAPL|NVDA|TSLA` signs fresh
bundles only for configured PRE/REGULAR/POST phases; phase 5 returns “no Yahoo source” intentionally.
The swap UI uses no new stock quote during phase 5 and asks the router to validate the historical
close anchor instead. Overnight phase 4 is not configured for live quotes. Yahoo quotes still pass
symbol, currency, phase, observation-age, and onchain high-water checks. `/pools` returned HTTP 200
with an empty pool list at block `102238721`; no live pool has been created yet. The app displays
that real empty state and falls back to the connected wallet's RPC if the public directory is unavailable.

### Session-aware maintenance rollout — 2026-10-31

`CalendarRegistry.activateInterval` was permissionlessly called for AAPL, NVDA, and TSLA after all
three current intervals had expired. The active phase is 5 through `2026-11-02T09:00:00Z` (04:00
Eastern Standard Time). Transactions: AAPL `0xbf3a3c7682c3207e3e1fa74db48c44062b501b6a7aa4f60082281fa9e226dd30`,
NVDA `0x95733483fb9b8a5a4646b6a10bc358d945be608ec475e4dd67acd6d8b0bcbdfd`; TSLA activation:
block `102233690`. Each calendar activation used about 130,900 gas and cost about `0.00000262 ETH` at the observed fee.

The prior Friday close anchor is missing for all three assets (`anchorStatus` reason bit 2048), so
weekend swap and weekend pool creation remain unavailable until a valid close is captured. Cloudflare
now has one weekday UTC cron that advances expired calendar intervals near 04:00, 09:30, and 16:00
Eastern, and submits signed source updates plus `captureClose` during the five minutes before 16:00.
It uses `BELL_TRANSACTION_PRIVATE_KEY`; `0.002 ETH` was moved from the funded deployment wallet to
that dedicated relayer (`0x01219888c2c11b1078c0a396faf3bc26bba742b5c5dea5a6db524ace62561c23`). It
does not publish stock prices every few minutes. The first scheduled close capture after deployment
is Monday 2026-11-02 at 15:55 Eastern (2026-11-02 20:55 UTC); the anchor is valid only if live source,
direct reference, and onchain checks all pass.

The published calendar roots cover only through 2026-12-29 and use the weekday session template; no
holiday or early-close table is committed. Queue an accurately sourced replacement before coverage
ends. Live overnight equities also remain unavailable: the active descriptors do not include an
overnight stream, and the Chainlink report probe returned Unauthorized. Weekend/overnight use is a
frozen, validated reference with live pricing for other assets, not a live stock market quote.

Registry health expires after 120 seconds, so it needs a fresh prepare close to pool creation. No fixed
seed amount is selected. The Create UI reads the current service fee, recipient, wallet balances and gas
quote live; the creator chooses seed amounts and must have the tokens plus fee and native gas. Seed
preflight derives the opening price from the sorted seed ratio for `SESSION_ONLY`, mines the predicted
Hook, previews PoolId/ticks/caps, and checks the resulting PoolCreated event against that prediction.

The web `/pools`, `/pool`, and `/swap` routes now use the Mainnet factory/policy API, signed quote
bundles, wallet token balance/allowance reads, exact-input and exact-output swap modes, token approval,
BellRouter simulation, and transaction receipt/explorer links. Create supports active registry assets,
including MEME only as `SESSION_ONLY`. Pool detail shows live market phase, policy validity, caps,
remaining budgets, PoolId and indexed block. Position removal accepts per-token minimum outputs. A live
swap cannot run until a Mainnet pool has been created and seeded. The signed pull design
and implementation details are in `docs/superpowers/specs/2026-10-30-pull-oracle-design.md`.

---

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
