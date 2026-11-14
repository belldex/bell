# PQ Hooks v2 Phase 2 implementation plan

## Goal

Prepare the complete Phase 2 BELL hook stack for Robinhood Chain Mainnet (`4663`) without changing deployed pools or broadcasting. The Phase 2 design must preserve the existing BELL policy, auction and LP exit behavior while placing hybrid authorization at every trusted state mutation. Phase 3 stays research-only as the brief specifies.

## Current architecture findings

- Phase 1 registries on Elysium are standalone demonstrations; they do not implement the production calendar/session registry interfaces.
- `BellHookV2` reads the existing `BellPolicyOracle`, `SessionRegistry`, `CalendarRegistry` and `SafetyController` interfaces. The hook mask is `0x2cc0`; it has no remove-liquidity callback.
- A Phase 2 replacement must preserve the existing read ABI and policy semantics. Simply wiring the Phase 1 registries into a new hook would not work or provide complete PQ coverage.
- Existing trust update paths include direct registry methods and ECDSA reporter envelopes. These must be moved behind hybrid authorization before any claim of Phase 2 completion.

## Work sequence

1. [x] Add a HybridAuth-backed SafetyController implementation that preserves the view ABI consumed by BELL, exposes only hybrid-authorized state changes, retains permissionless execution of matured timelock operations, and cannot gate LP removal.
2. [x] Add focused tests for role authorization, rejected legacy mutation selectors, timelock execution/cancel behavior, and unchanged pause-state read semantics.
3. [~] Map production registry write paths to hybrid envelopes and design compatible v2 registry implementations without replacing mature policy logic with Phase 1 demo mappings. Safety/governance actions and calendar root publication use HybridAuth. For Mainnet prices, reuse the existing onchain Chainlink source adapters and keep the production SessionRegistry close-capture path permissionless and deterministic; this avoids an unimplemented keeper signature for each close anchor and avoids routine PQ report signing. Remaining work is deployment, new calendar-root lifecycle, and end-to-end pool operation.
4. [x] Implement the v3 policy/hook/deployer/factory path, exact hook-mask checks, Lens binding, registry compatibility and auction continuity. V3 oracle, hook, deployer and factory artifacts preserve the production policy and auction path. An LP-owner-authorized per-pool Lens registry (which verifies the owner's seed NFT and its exact PositionManager pool key), deployment script, Worker read path and conditional UI registration flow are implemented. The full stack simulates on Robinhood Mainnet without broadcasting.
5. [~] Run focused verification, EIP-170 / initcode checks, exit-liveness tests, Mainnet source preflight and full-stack deployment simulation. Sourcify exact-match publication and an independent cryptographic review remain release gates after deployment/review.

## Acceptance gates

- Every privileged mutation requires valid ECDSA and PQ authorization; invalid either signature leaves state unchanged.
- The new controller exposes the same pause and operation read ABI used by `BellHook`.
- The hook permission mask has no remove-liquidity flag and exit-liveness checks pass.
- The new stack reads compatible v2 registries and preserves calendar, price, session, fee, cap, and auction semantics.
- No deployment is described as production-complete until all gates and source verification are evidenced.

## Progress

`SafetyControllerV2.sol` is implemented as an isolated PQ-profile component. Its view selectors match `ISafetyController`; `governance()` returns the controller itself so legacy registries can accept forwarded governance calls. Guardian cancellation forwards only `cancel(bytes32)` after hybrid authorization.

`HybridYahooAttestedSourceAdapter.sol` remains available for a future explicitly signed source path, but the Mainnet deployment does not instantiate it. `ChainlinkEquitySessionAdapter` and `AggregatorAdapter` already exist at the pinned Mainnet addresses and cover direct, regular, extended, and overnight source wires for all three stocks.

`HybridSessionRegistryAdapter.sol` remains tested but is not bound by the Mainnet deployment: the current keeper calls `captureClose` and has no path to produce this wrapper's keeper hybrid signature. The deployment binds `SessionRegistry` directly; it derives anchors from live Chainlink adapters, the published calendar and the stock token's corporate-action getters. `BellPolicyOracleV2`, `BellHookV3`, `BellHookDeployerV3` and `BellPoolFactoryV3` preserve the current policy/auction implementation and the `0x2cc0` hook mask with no remove-liquidity permission. `BellSwapLensRegistry` verifies the registering caller owns the pool's seed NFT and that the PositionManager reports the exact hook and pool ID before deploying one Lens and exposing its onchain binding. The UI can register the Lens after pool creation as a second transaction; the Worker can resolve Lens addresses from the registry, with its previous static map retained as fallback.

Still missing before a live PQ pool can operate: deploy the simulated stack, publish hybrid-authorized calendar roots for the new stock descriptor IDs, activate the roots and intervals, configure the production Worker from verified deployment evidence, and create/seed a pool. Routine Chainlink prices need no PQ reporter integration; HybridAuth is used for governance and calendar root changes. Independent cryptographic/security review and exact-match source publication remain release evidence.

Mainnet preparation targets Robinhood Chain (`4663`). A dedicated Foundry `pq_mainnet` profile builds the isolated PQ package. Four encrypted 4,096-leaf signer states and public commitments are prepared under `contracts/pq/keys/robinhood-4663/`; they are distinct from Elysium state. Mainnet wire plan tests pass (2), and the PQ suite passed earlier (19). Three RPCs agree on chain ID `4663`; a fresh source preflight passed all nine token/feed/proxy code identity checks at common block `113853158`. That preflight does not establish source licensing or guarantee that every feed is currently fresh.

The full-stack dry run generated `evidence/deploy/pq-hooks-mainnet-dry-run.json` with status `SIMULATED_NOT_DEPLOYED`. It simulates 21 EOA transactions and reuses the existing four Chainlink adapters per stock. The latest simulation used `64,125,543` gas at `0.040216001 gwei`, an estimated deployment cost of `0.002578872901413543 ETH`; a 30% reserve brings the required deployer balance to `0.003352534771837606 ETH`. The live balance check read `0.000140389082588 ETH`, leaving a reserve-inclusive shortfall of `0.003212145689249606 ETH`. This excludes calendar transactions, pool creation/seeding, and keeper operations. The local `.env` sets governance delay and calendar lead to zero, which the contracts support as deployment policy; HybridAuth still requires both role signatures for governance. No transaction was broadcast. Predicted addresses depend on the deployer's nonce remaining unchanged.

The deployment manifest now includes each genesis token beside its descriptor ID. The Mainnet calendar setup derives its stock and USDG map from these PQ IDs rather than the older descriptor queue; it refuses to broadcast against a manifest that has not been verified live. Calendar reads and writes still require a real deployed stack, so they cannot be dry-run against the predicted addresses before deployment.

Operational-cost check: the old `0.038 ETH/day` lower-bound projection applied only to the rejected plan of SHRINCS-signing six Yahoo reports per minute. The selected deployment reads Chainlink feeds onchain and does not sign routine price reports. The `215,773 gas` verifier measurement is a local component benchmark. Do not treat the pool as production-operable based on deployment simulation alone.

Focused verification completed: full production Solidity build passes; the V3 unit suite passes, including the Lens registry (4), V3 hook deployer (1), adapter-to-SessionRegistry (5), and anchor-adapter tests (4); HybridAssetRegistry tests pass (2); PQ tests pass (19). Mainnet wire/signer tests pass (4). V3 hook runtime is 23,621 bytes, below the 24,576-byte EIP-170 ceiling, and the Mainnet full-stack simulation succeeds. These checks do not replace the full repository suite, an independent cryptographic review, live signer/keeper integration, calendar activation, pool seeding, or exact-match source publication. No Mainnet deployment or broadcast has been performed.

## Deployment record, 14 November 2026

The Phase 2 stack was broadcast to Robinhood Chain Mainnet (`4663`): 15 contracts in 21 transactions, all successful, blocks `113918086` to `113918228`, `49,293,796` gas for `0.000987 ETH`. The record, with every transaction hash and the checks run afterwards, is `evidence/deploy/pq-hooks-mainnet.json` (status `BROADCASTED_AND_LIVE_CODE_VERIFIED`). Calendar tooling must be pointed at it with `BELL_MAINNET_MANIFEST=evidence/deploy/pq-hooks-mainnet.json`; the production manifest `mainnet-4663.json` was not changed.

Checked on chain after deployment: bytecode at all 15 addresses; PQKeyRegistry sealed with the four roles matching `deployments/robinhood-4663-keys.json` (budget 4,096, leaf 1, key version 1); HybridAuth, HashSigVerifier, SafetyControllerV2, hook deployer and Lens registry wiring; the AAPL, NVDA, TSLA and USDG descriptor ids; the factory profile hash. The full contract suite (560 tests) and the V3 exit-liveness fuzz passed before broadcast.

Fixed at deployment and not changeable: `governanceDelaySeconds = 0` and `calendarPublicationLeadSeconds = 0` in SafetyControllerV2 (both are immutable).

Calendar: roots for AAPL, NVDA and TSLA were queued through `SafetyControllerV2.queueGovernanceCall` (ECDSA plus SHRINCS, governance leaves 1 to 3), executed, activated, and the first interval activated (phase CLOSED until `2026-11-16T01:00:00Z`). Coverage runs to `2027-01-01T00:00:00Z`. State is in `evidence/deploy/pq-hooks-mainnet-calendar-state-<SYMBOL>.json`. The calendar script writes its state to `mainnet-4663-calendar-state-<SYMBOL>.json`, the same names as the production calendar; those production files were restored from git after the run and must not be overwritten by a later PQ run without the same care.

Still open: a keeper to activate each later interval (the first ends 2026-11-16T01:00:00Z), Worker configuration for the new factory, a first pool (the factory charges a 49 USDG service fee plus the seed), and independent cryptographic review.
