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

## Timeline, and why it is not instant

Mainnet governance is not instant. `PolicyConstants` applies these when `block.chainid != 46630`:

| Constant | Value | Effect |
|---|---|---|
| `CALENDAR_PUBLICATION_LEAD_SECONDS` | 604800 (7d) | `queueRoot` requires `coverageStart >= now + 7d` |
| `GOVERNANCE_MINIMUM_DELAY_SECONDS` | 172800 (48h) | `activateRoot` and `activateAsset` refuse before `now + 48h` |
| `GOVERNANCE_OPERATION_EXPIRY_SECONDS` | 604800 (7d) | the operation dies 7d after its ETA |

So a calendar root is a **three-step, multi-day** operation:

```
day 0     queueRoot          coverageStart must be >= day 7
day 2     activateRoot       window: [eta, min(coverageStart, expiry))
day 7+    activateInterval   only once the chain clock is inside a leaf
```

`activateRoot` is a half-open window: it must be at or after the ETA and strictly before
`coverageStart`. Miss it and the root cannot be activated at all — and because a root is
single-slot per `(asset, year)`, that asset identity is spent. `node scripts/deploy/mainnet-calendar.mjs plan`
prints the window from chain time before anything is signed.

Asset admission has the same 48h delay but no leaf window: `activateAsset` accepts any time in
`[eta, expiry]`.

## 1. Fill `.env`

```bash
RH_MAINNET_RPC_PRIMARY=https://<mainnet-rpc>
RH_MAINNET_RPC_SECONDARY=https://<second-provider>          # head-agreement check
RH_MAINNET_DEPLOYER_PRIVATE_KEY=0x...                        # dedicated; never treasury or guardian

MAINNET_GOVERNANCE_ADDRESS=0x...                             # must be a real multisig/timelock
MAINNET_GUARDIAN_ADDRESS=0x...                               # distinct from governance and treasury
MAINNET_TREASURY_ADDRESS=0x...                               # distinct; NOT the burn address
MAINNET_SERVICE_RECIPIENT=0x...                              # receives the pool service fee

MAINNET_WETH_ADDRESS=0x...                                   # canonical wrapped ETH on 4663
MAINNET_FEE_TOKEN_ADDRESS=0x...                              # real token; factory fails closed at zero

YAHOO_REPORTER_ADDRESS=0x...                                 # the signer the verifier will pin
YAHOO_REPORTER_PRIVATE_KEY=0x...                             # used by the keeper, not by deploy

BELL_POOL_CLASS=1                                            # SESSION_ONLY only
BELL_POLICY_ID=bell-mainnet-v1                               # hashed into the factory profileHash
BELL_MAINNET_SYMBOL=AAPL
```

`BELL_POLICY_ID` is load-bearing: `BellPoolFactory` stores `profileHash = keccak256(config)` with the
tokens zeroed but the policy id **kept**. A pool request whose policy id differs reverts
`InvalidConfiguration`. `mainnet-create-pool.mjs` re-derives the hash and compares it against the
deployed `profileHash()` before signing.

## 2. Preflight (read-only, no gas)

```bash
pnpm mainnet:preflight
```

Fails closed on: wrong chain id, RPC head disagreement over 50 blocks, deployer below 0.5 ETH,
non-distinct or zero roles, treasury/guardian equal to the deployer, missing code at WETH/fee
token/Permit2, a WETH symbol that is not `WETH`, a fee token without `decimals()`, and any fee token
whose symbol is the testnet `mBELL` fixture.

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

## 5. Admit assets (queue, wait 48h, activate)

```bash
pnpm mainnet:admit:queue      # queues WETH and the stock asset
pnpm mainnet:admit:status     # shows eta/expiry/executableNow for both
# ... 48 hours later ...
pnpm mainnet:admit:activate
```

Both WETH and the stock asset go through the delay; WETH is not exempt. The script refuses a token
that is not in `config/assets/candidates.mainnet.json`, and refuses a symbol matching
`facade|testnet|rehearsal|fixture|mock`.

## 6. Commit the calendar

```bash
pnpm mainnet:calendar:plan               # prints the window before anything is signed
pnpm mainnet:calendar:queue              # day 0
# ... 48 hours later, before coverageStart ...
pnpm mainnet:calendar:activate-root
# ... once chain time is inside the first leaf ...
pnpm mainnet:calendar:activate-interval
```

State is persisted in `evidence/deploy/mainnet-4663-calendar-state.json`. Each step is resumable and
re-reads chain state, so a failed run does not need a fresh asset.

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
pnpm mainnet:swap -- --zeroForOne=true --amount=1000000000000000
pnpm mainnet:acceptance
```

The swap goes through `BellRouter`, not the `TestnetSwapExecutor` fixture. The router enforces nonce,
deadline, a non-zero `limitAmount`, and canonical WETH wrap/unwrap; the helper refuses native input
unless the input really is WETH.

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
