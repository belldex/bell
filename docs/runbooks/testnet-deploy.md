# Runbook — Deploy the Rehearsal to Robinhood Testnet (chainId 46630)

Status: **REHEARSAL**, not mainnet. PRICE_GUARDED remains blocked; the rehearsal factory supports
SESSION_ONLY only. The production treasury path is not integrated into the factory (see evidence/treasury-adapter-results.md).

Current system state: **`docs/CURRENT-STATE.md`**. This runbook only explains how to rerun the deployment;
if the two documents differ, `docs/CURRENT-STATE.md` is authoritative.

## 0. On-chain-verified prerequisites
- Permit2 canonical ada di testnet: `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- The canonical v4 PoolManager **does not exist** → the script deploys its own PoolManager (owner = deployer)
- RPC testnet: `RH_TESTNET_RPC_PRIMARY` (Alchemy) + `RH_TESTNET_RPC_SECONDARY` (Pinax)

## 0b. Current deployment state (2026-10-27)

Manifest `evidence/deploy/testnet-46630.json`, hash `0x2ca2ec5aa5b2903ae0b1af2b9c8f11eb0635dc1a4b50128c7654ca8718e24a0b`,
sourceCommit `ee407db`, block `142881475`–`142881484`.

Deployed and verified: 10 rehearsal contracts + 6-decimal mBELL fee token + Yahoo verifier
and 4 Yahoo adapters (direct/regular/extended/overnight).

Not yet present: pool, swap, calendar root, stock descriptor. Only the WETH counterasset is ACTIVE.

Verifikasi ulang kapan pun:

```bash
node scripts/deploy/check-testnet-addresses.mjs --rpc      # addresses + bindings + code sizes
node scripts/deploy/verify-testnet-deployment.mjs --check  # does evidence still match the chain?
```


## 1. Isi environment
`.env` (repo root, not committed):
```
DEPLOYER_PRIVATE_KEY=            # testnet deployer wallet, 64 hex characters (0x optional)
TESTNET_TREASURY_ADDRESS=        # governance + guardian + treasury SafetyController
TESTNET_SERVICE_RECIPIENT=       # penerima service fee (nonzero)
TESTNET_FEE_TOKEN_ADDRESS=       # kosong = FeeTokenNotBound (fail-closed)
TESTNET_POOL_CLASS=1             # SESSION_ONLY
```
Ensure the deployer wallet has testnet ETH (faucet)—about 0.02 ETH is required for all phases.

## 1b. (Optional) Rehearsal fee token
The factory requires a fee token for createAndSeed; without one, every create reverts with FeeTokenNotBound.
For rehearsal, deploy a 6-decimal mock once and fill in its address:

    cd contracts
    set -a; source ../.env; set +a
    forge script script/DeployFeeToken.s.sol --rpc-url "$RH_TESTNET_RPC_PRIMARY" --broadcast -vv
    # copy the address from evidence/deploy/testnet-46630-fee-token.json into TESTNET_FEE_TOKEN_ADDRESS

This is a fixture (not USDG) and only proves the fee/decimal path; the USDG identity remains MISSING.

## 2. Deploy

There are **two entry points** for the same deployment. Choose one, not both—both call the same
Foundry script and write the same manifest.

**A. Direct Foundry** (most transparent, used for the first rehearsal):
```bash
cd contracts
set -a; source ../.env; set +a
forge script script/DeployTestnet.s.sol --rpc-url "$RH_TESTNET_RPC_PRIMARY" --broadcast -vv
```

**B. Node runner** (optional; validates the manifest against the canonical schema + prints the hash):
```bash
set -a; source .env; set +a
node scripts/deploy/deploy-testnet.mjs --dry-run   # cek urutan tanpa broadcast
node scripts/deploy/deploy-testnet.mjs             # broadcast + validasi manifest
```
The Node runner calls the `forge` binary from `PATH`. If Foundry is only in `~/.foundry/bin`,
add it to `PATH` first (`export PATH="$HOME/.foundry/bin:$PATH"`).

The script fails closed if: chainId ≠ 46630, treasury/guardian/recipient is empty, the three roles
are not distinct, poolClass ≠ 1, or the predicted factory address does not match.

Deployment order (one transaction per contract):
1. `SafetyController(governance, guardian, treasury)` — all three addresses **must** be distinct
2. `AssetRegistry(safety)`
3. `CalendarRegistry(safety)`
4. `SessionRegistry(assets, calendar)`
5. `PoolManager(deployer)`
6. `WETH` fixture — only if `TESTNET_WETH_ADDRESS` is empty (there is no canonical WETH9 on this chain)
7. `PositionManager(manager, permit2, 100000, descriptor=0, weth9=WETH)`
8. `BellHookDeployer(futureFactory, sessionRegistry, keccak256(BellHook.creationCode))`
9. `BellPoolFactory(profile, hookDeployer, feeToken, recipient)`
10. `BellRouter(poolManager, WETH)`

The manifest is written automatically to `evidence/deploy/testnet-46630.json` (14 required address fields:
`deployer, treasury, serviceRecipient, permit2, safetyController, assetRegistry, calendarRegistry,
sessionRegistry, poolManager, positionManager, hookDeployer, poolFactory, weth, router`; plus
`feeToken`, `status`, `note` — 18 keys total, 16 of them addresses).

The Yahoo price path is **not** included in this deployment script and is deployed separately:

```bash
node scripts/deploy/deploy-yahoo-verifier.mjs         # YahooSourceVerifier
node scripts/deploy/deploy-yahoo-adapter-weth.mjs     # adapter direct
node scripts/deploy/deploy-yahoo-stream-adapters.mjs  # adapter scope 1/2/3 + facade testnet
```

`deploy-yahoo-stream-adapters.mjs` also deploys `AaplTestnetFacade` because the stream-mode adapter
constructor requires `stockToken.code.length != 0` on the deployment chain, while AAPL Mainnet has no
code on Testnet. The facade is **not** a canonical token and is recorded as
`isCanonicalToken: false` di evidence.

## 3. Verifikasi pasca-deploy
- `eth_getCode` for every address in the manifest ≠ `0x`
- `factory.hookDeployer()` and `factory.profileHash()` match the manifest
- `deployer.getNonce()` bertambah tepat 10
- `SessionRegistry.assetRegistry()`/`calendarRegistry()` point to the manifest addresses
- `BellRouter.poolManager()` = manifest `poolManager`, `BellRouter.canonicalWeth()` = manifest `weth`
- `PoolManager.owner()` = deployer (ownership handover when the rehearsal is complete)
- `factory.liquidityMode()` = `0` (PUBLIC) for this rehearsal. The profile is immutable, so this factory
  **cannot** create a TREASURY_ONLY pool; the treasury path requires a second factory deployment with
  `liquidityMode=1` + `treasuryAdapter` terisi.
- `router.poolManager()` / `router.canonicalWeth()` point to the manifest; `weth.symbol()` = `WETH`

After deploying or redeploying, run **three** guards. The order matters: verify first, then
bandingkan.

```bash
node scripts/deploy/verify-testnet-deployment.mjs        # regenerate evidence from chain + manifest
node scripts/deploy/check-testnet-addresses.mjs          # offline: manifest vs evidence vs status module
node scripts/deploy/check-testnet-addresses.mjs --rpc    # + ukuran code on-chain
```

`verify-testnet-deployment.mjs` derives the entire contents of `testnet-46630-verification.json` from the chain
and manifest: addresses, code sizes, code hashes, 15 bindings, roles, and gas from the broadcast log. Never
edit this file by hand—that caused the 2026-10-27 drift incident, when all ten addresses in the verification
file still belonged to the previous deployment and `check-testnet-addresses.mjs` failed with 11 errors.
`--check` exits 1 when evidence is stale, so it can be used in CI.

Three places store the same addresses (the manifest, `testnet-46630-verification.json`, and
`packages/protocol/src/testnet-status.mjs`, used by the frontend). Without these guards, a redeploy
would leave two of the three pointing at old contracts.

## 4. Admission aset (testnet zero-delay, mainnet tetap 48 jam)

A pool cannot be created until `AssetRegistry` recognizes **both** tokens: `BellPoolFactory._admitted`
reverts with `InvalidConfiguration` if `asset0/asset1` is zero or `descriptorIdForToken(token)` does not match.

```bash
# Step 1 — queue. On chainId 46630, the testnet governance ETA is set to 0 seconds by owner decision.
node scripts/deploy/queue-testnet-asset.mjs --token=0x<TOKEN>          # preview (eth_call)
node scripts/deploy/queue-testnet-asset.mjs --token=0x<TOKEN> --broadcast

# Step 2 — activate immediately after queueing, within the 7-day operation window.
node scripts/deploy/activate-testnet-asset.mjs --operation-id=0x<ID> --token=0x<TOKEN> --eta=<UNIX>
node scripts/deploy/activate-testnet-asset.mjs --operation-id=0x<ID> --token=0x<TOKEN> --eta=<UNIX> --broadcast
```

Override zero-delay terbatas di kontrak pada `block.chainid == 46630`; chainId 4663 tetap memakai
`GOVERNANCE_MINIMUM_DELAY_SECONDS = 172800`. Jangan deploy/testnet override build ke mainnet.
The WETH rehearsal counterasset is already active in the current deployment (`descriptorId` in
`evidence/deploy/testnet-46630-asset-queue.json`); the queue tool detects the active descriptor and does not
send a duplicate transaction.

`activate-testnet-asset.mjs` simulates `activateAsset` through `eth_call` before broadcast,
maps reverts to `TIMELOCK` / `EXPIRED` / `ALREADY_DONE_OR_CANCELLED` / `TOKEN_CHANGED`, and after
broadcast verifies that `descriptorIdForToken(token)` is actually bound.

The counterasset side (WETH) is straightforward: `isStock=false`, `capabilityMask=0`, all adapters zero,
empty sourceConfig → `AssetPolicy.oraclelessCounterasset` passes the health gate. The stock side is **not**:
`_admitted` requires `SessionRegistry.health(id)` with `ready`, `reasonBits == 0`, and
`validUntil > now`, so it requires an adapter + source that actually reports.

### 4b. Why there is no stock descriptor yet

`descriptorIdForToken` currently returns zero for `AaplTestnetFacade`
(`0x64a82eb01d7c7310ef1bc5f0055f758409d45c63`) and for mBELL. Only WETH is ACTIVE.
Three blockers must all be resolved:

1. **Token.** Robinhood's official API returns 195 assets, all on chainId 4663 only. There are no official
   AAPL/TSLA/NVDA tokens on 46630. The facade only satisfies the adapter constructor's `stockToken.code.length`
   check; it is not canonical and must not be used as a stock identity.
2. **Calendar.** `CalendarRegistry.currentInterval(WETH)` returns all zeros. No root has been queued
   for any asset. Without an interval, `refreshHealth` for a stock will not pass.
3. **Source sample.** The last direct sample was 5500 seconds old at the 2026-10-27 trace, while the
   policy rejects samples older than 120 seconds. None of the three stream adapters has a sample yet.

Queueing a stock descriptor now would only cause a revert or leave health unready.
Do not queue something just to "look like progress".

## 5. Not yet covered (do not claim as complete)
- End-to-end pool create-and-seed: the WETH counterasset is active, but this requires a stock-token pair with
  a descriptor, adapter bindings, a healthy source report, and a valid calendar interval. Data/mock
  adapters must not be labeled as production stock/source; rehearsal fixtures must be explicitly identified.
- Swap: `BellHook.SWAP_EXECUTION_READY = false`; `_beforeSwap`/`_afterSwap` revert
  `HookNotImplemented()`. No swaps have occurred; this is intentional until
  M05-05 selesai.
- The factory has not called the treasury path (TreasuryAdapter). SafetyController's treasury is still the burn
  address `0x...dEaD`, so exit/handover cannot yet be rehearsed.
- Keeper A (Supabase) and Keeper B (Cloudflare) are not pointed at this testnet address yet.
- PoolManager ownership is still with the deployer.
- PRICE_GUARDED and mainnet readiness remain M14/M15.
