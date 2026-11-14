# BELL Post-Quantum Trust Inputs

## Current release state

- Phase 1 is deployed on Elysium testnet (chain ID `99801`). The deployment record is `deployments/elysium-99801.json`; transaction-level update proofs are in `../../evidence/pq/elysium-99801/hybrid-inputs.json`.
- The deployed profile is `shrincs-256s-keccak-stateful`. It verifies stateful SHRINCS signatures only. Stateless recovery is deliberately disabled.
- The Elysium deployment protects test calendar, session-close, price-attestation and role-key updates. It is not connected to a BELL pool or hook.
- Phase 2 is not deployed. The active target is Robinhood Chain Mainnet (`4663`). Its dry-run uses a new HybridAuth/SafetyController, asset/calendar/session registries, V3 oracle/hook/factory, auction binding and Lens registry. It reuses the already-deployed Chainlink adapters for AAPL, NVDA and TSLA; it does not deploy Yahoo report adapters. The plain `SessionRegistry` is bound into the hook so the existing Chainlink keeper can permissionlessly capture validated close anchors. Governance still needs both ECDSA and SHRINCS signatures; routine market reads do not.
- The Chainlink session feeds read the public onchain Robinhood AggregatorV3 contracts for REGULAR, PRE/POST and OVERNIGHT. Each session adapter checks feed, implementation and token identity and fails closed when the latest round is 120 seconds old. No Data Streams subscription or routine offchain report signing is in this path. The evidence currently says `rightsVerified: false`; this records source-rights review as unresolved.
- Calendar roots for new descriptor IDs still need hybrid governance and the configured timelocks, followed by root/interval activation. Phase 2 is not live until deployment, calendar activation, Worker configuration, a pool and its seed are verified. Independent cryptographic review and exact-match source publication remain release evidence; this is not an audit claim.
- The active deployment target is Robinhood Chain Mainnet (`4663`), per the current release request. A separate `robinhood-4663` signer profile now exists with fresh 4,096-leaf state for KEEPER, REPORTER, GOVERNANCE and GUARDIAN; it is isolated from Elysium keys. Public commitments are in `deployments/robinhood-4663-keys.json`. No Mainnet transaction has been broadcast. Phase 3 remains research-only because the brief defines it that way.
- BELL's integration has not had an independent cryptographic audit. Quip's upstream source and its Oak Security review are vendored at the pinned commits recorded in the deployment manifest and source tree. The upstream license is AGPL-3.0-or-later; preserve its notices and comply with that license when distributing or operating the derivative verifier.

## Build and test

From the repository root in PowerShell:

```powershell
$env:FOUNDRY_PROFILE = 'pq_testnet'
pnpm exec forge build --root contracts
pnpm exec forge test --root contracts -vv
node --test apps/web/test/quantum-page.test.mjs
pnpm --filter @bell/web typecheck
pnpm --filter @bell/web build
```

The isolated `pq_testnet` Foundry profile uses Solidity 0.8.30 and writes only to `contracts/out-pq` and `contracts/cache-pq`. Do not change the existing Mainnet profile to compile this package.

The `pq_mainnet` profile is separately bound to chain ID `4663`, compiles from pinned source pragmas, and writes to `contracts/out-pq-mainnet` and `contracts/cache-pq-mainnet`. Pass the RPC URL explicitly with `--rpc-url $env:RH_MAINNET_RPC_PRIMARY` for a Mainnet dry-run; its existence does not mean the stack is deploy-ready.

## Signer state

Install the pinned WASM signer dependencies from `contracts/pq/signer` with `npm ci`. Generate one encrypted state per role with a budget matching the onchain role key:

```powershell
node contracts/pq/signer/signer.mjs init keeper 64
node contracts/pq/signer/signer.mjs init reporter 64
node contracts/pq/signer/signer.mjs init governance 64
node contracts/pq/signer/signer.mjs init guardian 64
node contracts/pq/signer/signer.mjs status keeper
```

`init` prints only the public commitment. Keep `contracts/pq/keys/elysium-99801/*.enc` and `contracts/pq/.env.local` private. Back them up together in encrypted storage: losing either the encrypted signer state or its encryption key makes that key unusable. Never commit, paste, or send either file. Do not restore an older signer-state backup after any signature has been produced; that can reuse a one-time leaf.

`sign <role> <digest>` verifies its own signature and atomically persists the advanced leaf state **before** it prints the signature. A crash or lost output after signing still consumes that leaf. `preview` does not consume state and is for local rehearsal only. `preview-reuse` is disabled unless `BELL_PQ_ALLOW_REUSE_PROOF=1`; use it only for a disposable testnet rejection proof.

Every role has its own state file and lock. Do not copy one role's key to another role or run concurrent signing processes against the same role. Check the reported next leaf against `PQKeyRegistry` before signing after restore or handover. When a key budget is exhausted, stop signing and perform an authorized onchain role-key rotation; do not reset the local leaf counter.

## Testnet deployment

The existing deployment is complete. Re-running the deploy script creates a second, unrelated testnet stack; do so only when a fresh deployment is intended. The script reads EVM private keys from the existing ignored environment files and public PQ commitments from the generated metadata. It refuses every chain except 99801.

```powershell
.\contracts\pq\script\deploy-elysium.ps1
.\contracts\pq\script\deploy-elysium.ps1 -Broadcast
```

The first command simulates. The second broadcasts. Neither command deploys to Mainnet. After any deployment, check every address has runtime code and every receipt has status `0x1`; then update the deployment manifest without adding private keys or unencrypted PQ secret material.

## Deploy a pool quote Lens

`BellSwapLens` is one instance per pool and supports the V3 hook because `BellHookV3` inherits the existing `BellHook` read interface. The automatic route deploys a `BellSwapLensRegistry` once, then the owner of the pool's seed NFT calls `ensureLens(hook)` in a separate transaction after pool creation. The registry verifies the hook's factory, NFT owner, and exact PositionManager pool key before it records the Lens by pool ID. The app and Worker can then read that onchain binding. The registry itself is not deployed or configured on Mainnet yet.

To deploy the registry, set the factory, expected chain ID, output path and signer, then simulate first. The script refuses a chain mismatch and does not alter the factory or existing pools.

```powershell
$env:BELL_LENS_FACTORY = '0x...'
$env:BELL_LENS_EXPECTED_CHAIN_ID = '4663'
$env:BELL_LENS_REGISTRY_OUTPUT = 'deployments/lens-registry.json'
pnpm exec forge script --root contracts script/DeployBellSwapLensRegistry.s.sol --rpc-url $env:BELL_RPC_URL
```

Broadcast only after review and authorization. Once confirmed, put the returned `swapLensRegistry` address in `evidence/deploy/mainnet-4663.json` and Worker variable `BELL_SWAP_LENS_REGISTRY`. The existing per-pool script below remains available for legacy pools or manual registration.

```powershell
$env:BELL_LENS_HOOK = '0x...'
$env:BELL_LENS_EXPECTED_CHAIN_ID = '4663'
$env:BELL_LENS_OUTPUT = 'deployments/lens-pool-name.json'
pnpm exec forge script --root contracts script/DeployBellSwapLens.s.sol --rpc-url $env:BELL_RPC_URL --broadcast
```

The script reads the signer from `RH_MAINNET_DEPLOYER_PRIVATE_KEY`, `ELYSIUM_DEPLOYER_PRIVATE_KEY`, or `DEPLOYER_PRIVATE_KEY` (first configured value wins). Set the expected chain ID and RPC to the target hook's chain; it refuses a chain mismatch and validates hook code and pool ID before deploying.

## Testnet gas evidence

Measured transaction receipt gas for successful hybrid updates:

| Operation | Gas used |
| --- | ---: |
| Calendar root | 324,563 |
| Session close anchor | 324,662 |
| Price attestation | 302,554 |

These are measurements from the recorded Elysium testnet transactions. They are not a Robinhood Mainnet fee estimate. The price test uses deterministic synthetic AAPL data, not a market quote.

The public `/quantum` page links the deployed addresses, accepted update receipts and rejected invalid-ECDSA, invalid-SHRINCS and reused-leaf proofs. Explorer source verification is currently recorded as not verified. Do not describe the system as Mainnet-live, fully quantum-safe, or independently audited.

## Robinhood Mainnet Phase 2 preparation (2026-11-14)

`DeployPQHooksMainnet.s.sol` simulates 21 transactions on chain `4663`, including the PQ verifier and roles, SafetyControllerV2, registries with the complete AAPL/NVDA/TSLA descriptors, V3 hook/factory, auction bindings and Lens registry. Four existing Chainlink adapters per stock are reused. The simulation result is saved at `evidence/deploy/pq-hooks-mainnet-dry-run.json` with status `SIMULATED_NOT_DEPLOYED`; it is not deployment proof, and the predicted addresses require the deployer nonce to stay unchanged. The manifest records each genesis token beside its descriptor ID so the calendar setup cannot reuse the legacy registry IDs. No Mainnet transaction was broadcast.

The latest full-stack simulation used `64,125,543` gas at `0.040216001 gwei`: `0.002578872901413543 ETH`. With a 30% reserve, have `0.003352534771837606 ETH` available for deployment. The deployer balance at the same check was `0.000140389082588 ETH`, a reserve-inclusive shortfall of `0.003212145689249606 ETH`. This excludes hybrid governance/calendar transactions, pool creation and seeding, Worker transactions, and any gas-price change before broadcast.

The earlier `0.038 ETH/day` projection assumed SHRINCS-signed Yahoo reports every minute. That is not the selected Mainnet price path: onchain Chainlink reads remove routine PQ report signatures and avoid using a stateful reporter key for every quote. PQ leaves remain for infrequent governance actions such as calendar publication. The `215,773 gas` SHRINCS-only verifier measurement remains a local component benchmark, not a full Mainnet transaction receipt.

Governance delay, calendar publication lead and operation expiry are deployment parameters. The local `.env` sets the delay and lead to zero, so that is the configuration used by the current dry-run and the intended fast-launch setup; HybridAuth still requires both the governance ECDSA and PQ signatures. The default values apply only when those environment variables are absent. Confirm the resulting calendar coverage before broadcast.
