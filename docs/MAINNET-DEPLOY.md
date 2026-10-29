# BELL — Robinhood Chain MAINNET (4663) deployment

Everything here targets chain 4663. Testnet is 46630 and is a different, rehearsal-only deployment.

## What "ready to deploy" means here

The code path is ready. Three things are **not** proven by this repo and cannot be proven by it:

1. **Stock token rights.** `config/assets/candidates.mainnet.json` is `DOCUMENTED_CANDIDATES_NOT_ADMITTED`
   with `rightsMatrix: false`. Deploying contracts does not grant or prove a right to use Robinhood's
   token data.
2. **An independent price reference.** `PRICE_GUARDED` (pool class 0) stays blocked. Every pool this
   deployment can create is `SESSION_ONLY`.
3. **Keeper liveness in production.** The Worker is deployed separately and has to be pointed at the
   mainnet manifest.

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

So `queueAsset` → `activateAsset` and `queueRoot` → `activateRoot` → `activateInterval` all complete
without waiting. Verified by `contracts/test/unit/governance/GovernanceLatency.t.sol`, which asserts
same-block activation on chain id 4663.

The one remaining sequencing constraint is not a delay: `activateRoot` requires
`block.timestamp < coverageStart`, and `activateInterval` requires the chain clock to be inside a
leaf. Start coverage a few minutes in the future and do all three steps in one sitting.

Raise the values later if you want a real timelock — the contracts do not need redeploying to change
policy, but the delay is immutable per deployment, so a change means a new `SafetyController`.

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
YAHOO_REPORTER_PRIVATE_KEY=0x...                                      # already set; used by the keeper

BELL_POOL_CLASS=1
BELL_POLICY_ID=bell-mainnet-v1
BELL_MAINNET_SYMBOL=AAPL
BELL_MAINNET_MIN_DEPLOYER_WEI=500000000000000000                     # optional preflight floor

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
pnpm mainnet:yahoo-stack:broadcast
```

Deploys `YahooSourceVerifier(reporter)` plus three adapters (direct, regular, extended), each pinned to
the real stock token and to its own wire hash. It refuses to run if the token has no code and never
deploys a substitute — unlike the testnet script, which needs an `AaplTestnetFacade` because canonical
mainnet AAPL has no code on 46630.

`canonicalTokenId = keccak256(abi.encode(block.chainid, token))` is part of the wire hash, so the
adapters are mainnet-specific and cannot be reused from testnet.

## 5. Admit assets

```bash
pnpm mainnet:admit:queue      # queues WETH and the stock asset
pnpm mainnet:admit:activate   # same block when the delay is zero
pnpm mainnet:admit:status     # confirms both descriptors are ACTIVE
```

The script refuses a token that is not in `config/assets/candidates.mainnet.json`, and refuses a
symbol matching `facade|testnet|rehearsal|fixture|mock`.

## 6. Commit the calendar

```bash
pnpm mainnet:calendar:plan               # reads the deployed delays, prints the window
pnpm mainnet:calendar:queue
pnpm mainnet:calendar:activate-root
pnpm mainnet:calendar:activate-interval
```

All four can run back to back when the delays are zero. `activateRoot` must happen before
`coverageStart`, and `activateInterval` once the chain clock is inside a leaf, so start coverage a few
minutes ahead rather than in the past.

State is persisted in `evidence/deploy/mainnet-4663-calendar-state.json`. Each step re-reads chain
state, so a failed run does not need a fresh asset.

The calendar is a 60-day US-Eastern PRE/REGULAR/CLOSED partition built from real wall-clock boundaries
(04:00 / 09:30 / 16:00 ET), so DST is handled. Weekdays only: there is no holiday table, and the
keeper's source-freshness check is what stops trading on a holiday.

## 7. Create the first pool

The keeper must already be publishing — pool creation consumes health, it does not create it.

```bash
pnpm mainnet:pool              # calendar + health + balances + profile hash, then simulate
pnpm mainnet:pool:broadcast
```

Preflight refuses to broadcast when: no live calendar interval, health not ready, insufficient WETH /
stock / fee-token balance, or a derived profile hash that does not match the deployed factory.

Hook salt mining is CPU-bound (up to 200k keccak attempts) and stays here rather than in the keeper,
because it needs the deployer nonce and runs once.

## 8. Swap through the router, then accept

```bash
pnpm mainnet:swap -- --zeroForOne=true --amount=1000000000000000 --minAmountOut=<output-token-base-units>
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

- `PRICE_GUARDED` (pool class 0) is unreachable. Only `SESSION_ONLY` pools can be created.
- The deployed liquidity profile is PUBLIC (`liquidityMode=0`, `treasuryAdapter=0`); the
  `TREASURY_ONLY` path has no live deployment.
- The keeper must be pointed at `evidence/deploy/mainnet-4663.json` separately. This repo does not
  deploy it.
- Nothing here proves stock-token rights. `mainnet-acceptance.mjs` reports that as unverified rather
  than assuming it.
