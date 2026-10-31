# BELL — Robinhood Chain MAINNET (4663) deployment

> **Historical rollout notes.** The Yahoo pull-quote and old registry instructions below are superseded.
> The current Mainnet state, active Chainlink Data Feed adapters, Worker version, and production UI are
> recorded in [`docs/CURRENT-STATE.md`](CURRENT-STATE.md). Do not run the historical Yahoo rollout steps
> as the current Mainnet procedure.

Everything here targets chain 4663. Testnet is 46630 and is a different, rehearsal-only deployment.

## What "ready to deploy" means here

The protocol and Yahoo/reference stacks are deployed on chain 4663, stock assets/calendars are active,
and the scripts in this runbook continue the pool/keeper setup. The following remain unproven or
unfinished:

1. **Data rights.** `evidence/deploy/mainnet-4663-stock-adapters.json` records `rightsVerified: false`.
   Deployment proves the source wiring, not the rights to use the upstream quotes.
2. **Pool creation and liquidity.** No mainnet pool or swap exists yet. The PRICE_GUARDED matrix needs
   explicit seed amounts; all candidates need fresh session health. The deployer currently holds no
   WETH, USDG, or stock tokens for LP seeds.
3. **Pull stack rollout.** The quote-only Worker config is generated locally but not deployed. The
   pull-enabled SessionRegistry/Router/Hook stack and new pools are not deployed; there is no mainnet
   pool or swap yet. The reporter secret and Cloudflare rollout still need configuration.

## Current mainnet deployment record

The protocol stack is now deployed on Robinhood Chain mainnet (chain ID 4663). The canonical,
RPC-verified record is `evidence/deploy/mainnet-4663-broadcast.json`; it contains every contract
address, creation transaction, block, receipt status, runtime code hash and Blockscout URL. The
separate `evidence/deploy/mainnet-4663-verification.json` records on-chain wiring checks. Do not use
addresses from rehearsal evidence for mainnet.

Explorer: <https://robinhoodchain.blockscout.com>

The 10 protocol deployment receipts all returned success. Total measured gas cost was
`0.000801145289812 ETH`. This broadcast record is the initial protocol stack; subsequent deployment
evidence separately records Yahoo verifier/adapters, Chainlink reference adapters, asset admissions,
and calendars. It does not include a keeper deployment, pool, swap, or acceptance run. Consult the
latest evidence files before broadcasting; do not use this historical paragraph as a live readiness
check.

## Pull oracle and deployment boundary

The local implementation serves `/quote?symbol=AAPL`, `NVDA`, or `TSLA`. It checks the chain calendar,
fetches a phase-matched Yahoo quote, signs the direct and stream samples, and returns them without
sending a transaction. Wrangler's checked-in Mainnet config is set to `BELL_ORACLE_MODE=pull`, with
the minute cron removed. Testnet push mode remains available. The quote Worker needs the RPC URL and
`YAHOO_REPORTER_PRIVATE_KEY`; pull mode does not need `BELL_TRANSACTION_PRIVATE_KEY` or a funded relayer.

Submitting a quote update costs gas in the caller's swap or explicit `prepareOracleUpdates` transaction.
Stock/quote pools need one update per stock leg; stock/stock pools need both. A first prepare after a
stale interval records recovery but remains blocked; a second fresh quote must be observed at least
60 seconds later. The existing observation age remains under 120 seconds. For a planned close, a caller
may pass the upcoming CLOSED leaf hash during the final five-minute capture window. No scheduled close
transaction is sent; if nobody captures an anchor, closed-phase swaps remain fail-closed.

Existing deployed contracts cannot be upgraded. Rollout requires a new SessionRegistry, Router, Hook
template and dependent stack, plus pools created against that stack. AssetRegistry, CalendarRegistry,
admitted stock assets, Yahoo verifier/adapters, and Chainlink feeds may be reused after exact wiring
verification. The new SessionRegistry begins with empty report/health state. No scripts in this change
broadcast or deploy any of these contracts or Worker changes.

## Timeline: it is instant by default

Governance latency is a **deployment parameter**, not a network property. The old design hardcoded
"zero delay on testnet, 7-day notice + 48-hour delay on mainnet" into the contracts, which is why a
mainnet launch used to take a week. That branch is gone: `SafetyController` takes three delays in its
constructor and the registries read them from the controller.

With the defaults in `.env` the whole launch is same-block:

```bash
BELL_GOVERNANCE_DELAY_SECONDS=0            # asset admission: eta == now
BELL_CALENDAR_PUBLICATION_LEAD_SECONDS=0   # no coverage notice
BELL_OPERATION_EXPIRY_SECONDS=604800       # operations still expire after 7 days
```

So `queueAsset` → `activateAsset` and `queueRoot` → `activateRoot` can complete in the same block.
The interval itself has a 5-minute activation buffer by default: `activateRoot` requires
`block.timestamp < coverageStart`, and `activateInterval` requires the chain clock to be inside a
leaf. Queue and activate the root immediately, then run `activateInterval` after that short buffer.
Verified by `contracts/test/unit/governance/GovernanceLatency.t.sol` and
`scripts/calendar/mainnet-timeline.test.mjs`.

Raise the values if you want a real timelock. They are immutable deployment settings. Because both
registries bind `SafetyController` immutably, changing them requires redeploying the controller,
registries and dependent stack; it cannot be changed by replacing only the controller.
With zero governance delay, resume and role-rotation operations are also immediately executable.
That is an explicit launch-speed tradeoff, not a retained 48-hour safety delay.

## 1. Fill `.env`

All values below already exist in `.env` for this deployment. The operator wallets are the same
addresses used on testnet, by request; only the deployer key and the two mainnet-only external
addresses are different.

```bash
RH_MAINNET_RPC_PRIMARY=https://<mainnet-rpc>                 # already set
RH_MAINNET_RPC_SECONDARY=https://<second-provider>            # already set; head-agreement check
RH_MAINNET_DEPLOYER_PRIVATE_KEY=0x...                         # mirrors DEPLOYER_PRIVATE_KEY

MAINNET_GOVERNANCE_ADDRESS=0x6C3659988bd5f9E94F927B3FD7d0Ee3746f8d399   # = TESTNET_GOVERNANCE_ADDRESS
MAINNET_GUARDIAN_ADDRESS=0x072f9d4165DccBD9172023601d07bCE2FCF37072     # = TESTNET_GUARDIAN_ADDRESS
MAINNET_TREASURY_ADDRESS=0xF6e272FBF862AE055949C61BC41E6395dfE20841     # = TESTNET_TREASURY_ADDRESS
MAINNET_SERVICE_RECIPIENT=0x58Cd82a008cB9a6c0c605991b40a09BD6aa1a6fC    # = TESTNET_SERVICE_RECIPIENT

MAINNET_WETH_ADDRESS=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73        # canonical WETH on 4663
MAINNET_FEE_TOKEN_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168   # USDG on 4663

YAHOO_REPORTER_ADDRESS=0x6C8bAF28eA08DD00A1A64EE350167A70A7b3E98a       # already set
YAHOO_REPORTER_PRIVATE_KEY=0x...                                      # already set; signs /quote bundles

BELL_POOL_CLASS=1
BELL_POLICY_ID=bell-mainnet-v1
BELL_MAINNET_SYMBOL=AAPL
BELL_MAINNET_MIN_DEPLOYER_WEI=7000000000000000                       # optional override; default 0.007 ETH
BELL_MAINNET_GAS_RESERVE_WEI=5000000000000000                        # retain 0.005 ETH after WETH wrapping

# Instant launch. Raise these for a real timelock.
BELL_GOVERNANCE_DELAY_SECONDS=0
BELL_CALENDAR_PUBLICATION_LEAD_SECONDS=0
BELL_OPERATION_EXPIRY_SECONDS=604800
```

The two mainnet-only external addresses were verified on chain 4663, not copied from testnet:
`0x0Bd7D308…` returns symbol `WETH` with 18 decimals and 2202 bytes of code, and `0x5fc5360D…` returns
symbol `USDG` with 6 decimals. The testnet fee token and the testnet WETH fixture both have **zero**
code on mainnet, so reusing them would have failed at the factory.

Note: because the deployer wallet is shared and its mainnet nonce starts at 0, the deployed contract
addresses will collide with the addresses that wallet produced on testnet at the same nonces. That is
expected — CREATE depends only on sender and nonce — but it means a mainnet address must never be
read from testnet evidence.

`BELL_POLICY_ID` is load-bearing: `BellPoolFactory` stores `profileHash = keccak256(config)` with the
tokens zeroed but the policy id **kept**. A pool request whose policy id differs reverts
`InvalidConfiguration`. `mainnet-create-pool.mjs` re-derives the hash and compares it against the
deployed `profileHash()` before signing.

## 2. Preflight (read-only, no gas)

```bash
pnpm mainnet:preflight
```

Fails closed on: wrong chain id, RPC head disagreement over 50 blocks, deployer below the funding
floor, non-distinct or zero roles, treasury/guardian equal to the deployer, missing code at WETH/fee
token/Permit2, a WETH symbol that is not `WETH`, a fee token without `decimals()`, and any fee token
whose symbol is the testnet `mBELL` fixture.

The floor defaults to 0.5 ETH and can be lowered with `BELL_MAINNET_MIN_DEPLOYER_WEI` for a readiness
report on an unfunded wallet.

## 3. Deploy the protocol stack

```bash
pnpm mainnet:deploy                 # simulate only
pnpm mainnet:deploy:broadcast       # writes evidence/deploy/mainnet-4663.json
pnpm mainnet:verify                 # derives evidence from the live chain
```

The Foundry script (`contracts/script/DeployTestnet.s.sol`) is env-driven and shared with testnet. On
mainnet it additionally requires a canonical WETH and a real fee token, and refuses a treasury or
guardian equal to the deployer.

## 4. Deploy the Yahoo source stack

```bash
pnpm mainnet:yahoo-stack             # plan only; prints wire hashes
pnpm mainnet:yahoo-stack:broadcast  # requires --i-authorize-spend
```

Deploys `YahooSourceVerifier(reporter)` plus three adapters (direct, regular, extended), each pinned to
the real stock token and to its own wire hash. It refuses to run if the token has no code and never
deploys a substitute — unlike the testnet script, which needs an `AaplTestnetFacade` because canonical
mainnet AAPL has no code on 46630.

`canonicalTokenId = keccak256(abi.encode(block.chainid, token))` is part of the wire hash, so the
adapters are mainnet-specific and cannot be reused from testnet.

## 5. Admit assets

```bash
pnpm mainnet:admit:queue      # queues WETH, USDG and every configured stock; requires --i-authorize-spend
pnpm mainnet:admit:activate   # same block when the delay is zero; requires --i-authorize-spend
pnpm mainnet:admit:status     # confirms both descriptors are ACTIVE
```

The script refuses a token that is not in `config/assets/candidates.mainnet.json`, and refuses a
symbol matching `facade|testnet|rehearsal|fixture|mock`.

## 6. Commit the calendar

```bash
pnpm mainnet:calendar:plan               # reads the deployed delays, prints the window
pnpm mainnet:calendar:queue # requires --broadcast --i-authorize-spend
pnpm mainnet:calendar:activate-root # requires --broadcast --i-authorize-spend
pnpm mainnet:calendar:activate-interval # requires --broadcast --i-authorize-spend
```

All four can run back to back when the delays are zero. `activateRoot` must happen before
`coverageStart`, and `activateInterval` once the chain clock is inside a leaf, so start coverage a few
minutes ahead rather than in the past.

State is persisted in `evidence/deploy/mainnet-4663-calendar-state.json`. Each step re-reads chain
state, so a failed run does not need a fresh asset.

The calendar is a 60-day US-Eastern PRE/REGULAR/CLOSED partition built from real wall-clock boundaries
(04:00 / 09:30 / 16:00 ET), so DST is handled. Weekdays only: there is no holiday table. Pull quote
requests read the active onchain calendar and refuse unsupported/closed phases; no background price
transaction is sent on holidays.

## 7. Deploy reference adapters and create product pools

Deploy the read-only Chainlink references (the default is plan-only), then select the requested
stock/counterasset pair for each pool invocation:

```bash
pnpm mainnet:reference-stack
pnpm mainnet:reference-stack:broadcast # adds --broadcast --i-authorize-spend
pnpm mainnet:pool -- --stock=AAPL --counterasset=USDG --amount0=<tokenA-units> --amount1=<tokenB-units>
pnpm mainnet:pool:broadcast --stock=AAPL --counterasset=USDG --amount0=<tokenA-units> --amount1=<tokenB-units> --i-authorize-spend
pnpm mainnet:pool -- --stock=TSLA --counterasset=WETH
```

Set `BELL_POOL_CLASS=0` for PRICE_GUARDED; it requires a live reference adapter for both assets.
Set `BELL_POOL_CLASS=1` for SESSION_ONLY; references are deliberately omitted. `--stock` accepts
every admitted candidate symbol. `--counterasset` accepts WETH, USDG, or another admitted stock.
For an admitted unpriced countertoken such as MEME, pass `--counterasset=MEME --counter-token=<active-token-address>`;
this remains SESSION_ONLY unless a separately approved, fresh independent reference is configured.
Each pool writes pair-specific evidence to `mainnet-4663-pool-<stock>-<counterasset>-<class>.json`.
USDG is admitted as a priced counterasset before using PRICE_GUARDED; a plain token admission is
not an oracle. Pool creation checks both stock health reports for stock/stock pairs and verifies
that balances cover the seed and, where the seed token is USDG, the 49-USDG service fee too.
Plan mode does not create pool evidence; a pair-specific evidence file is written only after a
successful create receipt.

Every state-changing command requires both explicit `--broadcast` and `--i-authorize-spend` flags.
The flags are intentionally never implied by `pnpm` defaults.

## 8. Create the first pool

The pool factory consumes fresh health; it does not create it. In pull mode, a caller must first prepare
the new SessionRegistry with signed bundles for the requested stock leg or both stock legs in a
stock/stock pair. The local prepare command fetches `/quote` for exactly those stock symbols, checks
their descriptor IDs against admission evidence, sorts the token/asset pairs, and simulates
`SessionRegistry.applyPoolOracleUpdates(asset0, asset1, encodedUpdates, false)` when no Hook is supplied:

```bash
pnpm mainnet:prepare-oracles -- --stock=AAPL --counterasset=USDG --quote-url=https://<quote-service>
pnpm mainnet:prepare-oracles -- --stock=NVDA --counterasset=TSLA --quote-url=https://<quote-service>
```

Both arguments are required. `BELL_QUOTE_SERVICE_URL` is the fallback for `--quote-url`.
Simulation is the default and needs no private key; `--account=<address>` optionally selects the
simulated gas payer. A real write requires both `--broadcast --i-authorize-spend` and a local wallet
key. Simulation does not persist health. This implementation has sent no prepare transactions, and
these commands require the new pull-enabled stack and quote service before they can succeed on Mainnet.
Create a pool only after Registry priming is committed and the factory health checks pass.

```bash
pnpm mainnet:pool -- --stock=AAPL --counterasset=USDG --amount0=<tokenA-units> --amount1=<tokenB-units>
pnpm mainnet:pool:broadcast --stock=AAPL --counterasset=USDG --amount0=<tokenA-units> --amount1=<tokenB-units> --i-authorize-spend
```

Preflight refuses to broadcast when: no live calendar interval, health not ready, insufficient WETH /
stock / fee-token balance, or a derived profile hash that does not match the deployed factory.

Hook salt mining is CPU-bound (up to 200k keccak attempts) and stays here rather than in the keeper,
because it needs the deployer nonce and runs once.

## 9. Swap through the router, then accept

For an existing pool with stale health or pending recovery, prepare the Hook so its recovery checkpoint
persists. Use the pair's exact Hook address; the command checks its token and asset IDs against the
requested pair. A first call after expiry starts recovery. Fetch a new quote and prepare again with an
advanced observation at least 60 seconds later; each report must still be younger than 120 seconds.
A reverting swap rolls back its oracle updates and cannot persist that first recovery checkpoint.

```bash
pnpm mainnet:prepare-oracles -- --stock=AAPL --counterasset=USDG --hook=<pool-hook> --quote-url=https://<quote-service>
```

The same simulation and explicit broadcast gates apply. During the last five minutes before a planned
close, callers may explicitly add `--close-boundary-hash=<canonical-upcoming-CLOSED-leaf-hash>` for the
`--stock` leg and `--counter-close-boundary-hash=<hash>` for a stock counterasset. The command checks
the onchain upcoming leaf and capture window. It never adopts an unsolicited close hash from a quote.
Missing the capture window leaves closed-phase swaps blocked under the existing policy.

An executable pool can include fresh updates atomically in its Router swap. The optional quote URL
fetches one bundle for each stock leg, including both sides of a stock/stock pool. Omitting the URL
uses an empty update array and relies on already-fresh onchain state. The web swap page remains a
fixture preview and cannot execute these live swaps.

```bash
pnpm mainnet:swap -- --stock=AAPL --counterasset=USDG --quote-url=https://<quote-service> --zeroForOne=true --amount=1000000000000000 --minAmountOut=<output-token-base-units>
pnpm mainnet:acceptance
```

The swap goes through `BellRouter`, not the `TestnetSwapExecutor` fixture. `--minAmountOut` is
required and is denominated in the output token's base units; it is never guessed from input amount.
The router enforces nonce, deadline, slippage, and canonical WETH wrap/unwrap; the helper refuses
native input unless the input really is WETH.

`mainnet:acceptance` is read-only and fails on: missing code, wiring mismatches, an unadmitted
descriptor, a dead calendar interval, blocking health reasons, a stale report, a hook that is not
LIVE, a swap that did not go through the router, a burn-address treasury or guardian, and a
PoolManager still owned by the deployer.

## Deliberate limits

- Full-product pool creation requires redeploying the updated protocol stack after the `PoolConfig`
  profile change; the already-live old factory cannot accept the new profile layout.
- The deployed liquidity profile is PUBLIC (`liquidityMode=0`, `treasuryAdapter=0`); the
  `TREASURY_ONLY` path has no live deployment.
- The pull quote Worker must be given evidence from the new deployment through
  `pnpm mainnet:keeper-config`; this repo does not deploy it.
- Nothing here proves stock-token rights. `mainnet-acceptance.mjs` reports that as unverified rather
  than assuming it.
