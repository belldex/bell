# M06-01 local atomic factory evidence — incomplete

Status: **BLOCKED_DEPENDENCY**, not DONE, release approval, audit, fork evidence or production deployment evidence. No credentials, network transactions or broadcasts were used.

## Implemented candidate boundary

`contracts/src/BellPoolFactory.sol` implements the normative factory interface for direct caller-funded PUBLIC setup. An explicit constructor profile locks every dependency and risk field except the two admitted token/descriptor identities. Other profiles require separately reviewed factory deployments; this is not evidence that either class's production profile has been established.

- Request hash uses `abi.encode(chainId, factory, caller, nonce, deadline, configHash, entireRequest)`; CREATE2 namespace is `keccak256(abi.encode(chainId, factory, caller, nonce, request.salt))`.
- Hook constructor key has zero hooks to avoid a prediction fixed point; the actual initialized key uses the predicted/deployed hook. Seed salt is `bytes32(PositionManager.nextTokenId())`, matching pinned PositionManager mint behavior.
- Validates exact immutable dependency/risk profile, admitted descriptor-to-token lookup, descriptor identity/codehash/decimals, cached health, nonce/deadline, literal NFT recipient (rejecting PositionManager address sentinels), strict seed-price containment and explicit liquidity/maxima.
- Calls factory-only beginSeed, core initialize, pinned `MINT_POSITION` plus `SETTLE_PAIR`, then clears both ERC20-to-Permit2 and Permit2-to-PositionManager temporary allowances. No from-deltas action, arbitrary target/actions, sweep, native currency or relayer entrypoint exists.
- Pulls exactly the two request maxima, using actual payer debits/factory credits. Verifies post-settlement residuals against starting balances and captured principal, verifies actual owner/pool/ticks/liquidity receipt, then activates once. Returns exact hook/pool/token/core-position-key/liquidity/principal result.
- Charges `49 * 10**tokenDecimals` from caller directly to the immutable project recipient only after activation; never charges factory principal or foreign balances. Refunds only request balance deltas; failed transfers revert the entire setup. Zero fee-token binding rejects creation rather than quietly creating a fee-free pilot.
- Existing hook swap enforcement readiness remains false. LIVE activation does not permit swaps. TREASURY_ONLY is rejected pending M06-03.
- PRICE_GUARDED creation now rejects with `PriceGuardUnavailable` before deployment/funding until its configured-reference initial-price band check exists. This class remains a product blocker, not a silently reduced deliverable.
- SESSION_ONLY requires exactly one admitted stock. Only an explicitly oracleless non-stock descriptor (all price/session adapters zero, capability mask zero) skips quote price health. Descriptor identity/codehash/decimals/evidence, actual transfer debits/credits and quote pause checks remain; stock health, source agreement, corporate checks and 60-second continuity are unchanged. SessionRegistry handles its empty source configuration without inventing quote price health.
- Creator equal to the immutable service recipient is rejected before deployment/funding; no self-payment semantics are inferred.

## Review round 1: EIP-170 refactor

The original oversized BellHook/BellHookDeployer artifacts are superseded. The hook now constructs and immutably binds a stateless `BellModeEvaluator` that exposes the unchanged pure ModePolicy decision and ClosureBudget cap calculation through STATICCALL, not delegatecall. All dependency reads, state/seed writes, callback permissions, recovery guards and swap readiness gates remain in the hook. Only unused internal evaluation-result fields were removed; the existing explicit deep-copy code is preserved.

The deployer places its compiled creation code into two immutable STOP-prefixed inert code chunks during construction, verifies the supplied template hash against the actual compiled creation code, and reconstructs exactly those bytes plus constructor arguments for CREATE2. Its runtime no longer embeds the entire hook creation code. No mutable implementation pointers, setters, arbitrary targets or delegatecall were introduced.

`forge build --root contracts --sizes` now **passes** with pinned default settings:

| Artifact | Runtime bytes | Initcode bytes |
| --- | ---: | ---: |
| BellHook | 24,390 | 34,677 |
| BellHookDeployer | 2,996 | 38,925 |
| BellModeEvaluator | 4,770 | 4,798 |
| BellPoolFactory | 15,234 | 18,569 |

Hook runtime margin is only **186 bytes**. Foundry tests gate the actual deployed hook, evaluator, deployer and both creation-code chunks against 24,576 bytes, verify inert chunk prefixes and verify reconstructed init-code hash equality to the compiled template. These tests run automatically within `pnpm check`; target-chain EVM/fork/deployment compatibility is still not proved.

## Local coverage and reproducible commands

From the BELL directory in PowerShell, the installed optional Forge binary is:

```powershell
$forge = 'node_modules/.pnpm/@foundry-rs+forge-win32-amd64@1.7.1/node_modules/@foundry-rs/forge-win32-amd64/bin/forge.exe'
& $forge test --root contracts --match-contract BellPoolFactoryTest -vv
& $forge build --root contracts --sizes
```

The latest focused suite demonstrated **36 passed, 0 failed, 0 skipped**. It exercises actual pinned PoolManager and PositionManager, with additional real AssetRegistry governance queue/48-hour activation and real SessionRegistry source/stock-health refresh paths. Permit2 settlement, verifier/source adapters, safety and calendar are deliberately synthetic fixtures; older atomic failure fixtures also use synthetic admission/health. Receipt corruption uses Foundry view-call mocks after real mint/settlement. This is not real Permit2 validation, independent security review or production acceptance.

Coverage includes rollback of hook deployment, initialized core slot, NFT, nonce, principal and service fee for initialization, either amount maximum, settlement, owner/pool/ticks/liquidity receipt, seed cap, activation, fee transfer and refund failures. Activation failure is injected during settlement so it reaches the real post-settlement hook activation check, not merely the factory precheck. Success checks actual core token credit, both principal debits, foreign balance preservation, overlapping LP/service currency, cleared allowances, replay rejection, all request fields and caller/chain domain separation, strict range endpoints, unsupported treasury mode, reentrant token callbacks and arbitrary hookData swap/second-seed rejection. Refunds are bounded by exactly `amountMax - capturedPrincipal`; a late fee-token callback donation is rejected, never swept to the caller.

Rollback assertions now cover both payer LP balances, both factory LP balances, both core token balances, both ERC20-to-Permit2 allowances, both Permit2-to-PositionManager allowances, service recipient balance and fee payer balance. Review-round tests additionally refuse priced initial creation, creator/service-recipient aliasing, no-stock or stock/stock SESSION_ONLY configurations, unhealthy/immature stock, paused quote, changed quote fingerprint, non-nominal quote credit and missing admission evidence. Real oracleless quote price health remains unready while both currency-order seed/activation tests pass.

TDD observations: the initial focused command failed because `BellPoolFactory.sol` did not exist; implementation followed. A later strict-range test failed with `range not validated`, then passed after explicit predeployment TickMath containment validation. The late-donation refund regression failed with `unexpected success`, then passed after refund amounts were explicitly bounded and checked against the original request residual. The package-level `pnpm exec forge` was not on PATH; the explicit installed binary above was used instead.

Review-round TDD: the initial new size tests failed with `deployer exceeds EIP-170` and `hook exceeds EIP-170`; class/self-fee tests failed with `priced initial guard bypass` and `self fee not rejected before funding`. Real-registry oracleless seed tests reverted on empty-config health refresh and required quote health. The corrected paths and size gates subsequently passed. An intermediate real-stock fixture crossed its exact freshness deadline; it was corrected to refresh every 30 seconds rather than weakening production continuity checks.

Pre-review `pnpm check` passed with 214 then-current Forge tests. The first review-round run also passed the unit, reference, compile, Foundry, Deno, worker, and dry-run stages, then exposed stale task statuses: M07-04/M07-05 and M08-01..05/M09-01 were marked DONE while retaining blockers. M07-04's live private-bucket roundtrip evidence was retained and its obsolete offline-only blocker removed; tasks with unresolved deployment/dependency blockers were restored to IN_PROGRESS. After the latest ledger reconciliation and owner-approved snapshot decision, a fresh full `pnpm check` **passed**: 243 Node unit tests, 45 engineering and 18 infrastructure reference tests, Solidity compilation (149 first-party/imported source files), **309 Forge tests**, ABI/package checks, 15 Deno tests, 6 worker tests, worker dry-run build, evidence check (E01–E06 remain NOT_RUN), and secret-boundary check. Do not confuse a full code/evidence-structure check PASS with release or deployment approval. For the offline review-round run, Wrangler's update-check banner, telemetry and dotenv loading were disabled:

```powershell
$env:PATH = "$PWD/node_modules/.pnpm/@foundry-rs+forge-win32-amd64@1.7.1/node_modules/@foundry-rs/forge-win32-amd64/bin;$env:PATH"
$env:CI = '1'
$env:WRANGLER_HIDE_BANNER = 'true'
$env:WRANGLER_SEND_METRICS = 'false'
$env:CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
pnpm check
```

## Unresolved blockers

1. No verified USDG token/decimals or project service-recipient deployment manifest. An explicitly provided local ERC20 is not proof of USDG identity. No address, peg, decimal assumption or fee-free production mode was invented.
2. PRICE_GUARDED initial reference-band integration remains **BLOCKED**; that class cannot create, even with a numerically valid initial price. EIP-170 sizes are now locally compliant, but target-chain Cancun/fork/deployment compatibility remains **BLOCKED** until verified.
3. Actual pinned Permit2 implementation integration remains **BLOCKED**: it pins Solidity 0.8.17, while this project's single-unit compiler profile pins 0.8.26. Tests use a narrowly labeled allowance/transfer double, not copied or modified Permit2 production code. Real AssetRegistry/SessionRegistry paths are now tested locally, but entitled production sources/verifiers and live admission evidence remain **BLOCKED**.
4. Reviewed immutable risk/reference-mode mappings and all-class/all-session deployment profiles are not established by the local candidate. Current `descriptorIdForToken` is used; no imaginary admission getter was added.
5. M05-05 production swap callbacks, M06-02 actual Permit2/target-fork acceptance, and TREASURY_ONLY integration in M06-03 remain outstanding. The factory may atomically set the hook lifecycle to LIVE in local tests, but mode stays HALTED and `canSwap=false`; no milestone or E01–E06 gate is upgraded to PASS.
