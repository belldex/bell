# BELL Post-Quantum Trust Inputs

## Current release state

- Phase 1 is deployed on Elysium testnet (chain ID `99801`). The deployment record is `deployments/elysium-99801.json`; transaction-level update proofs are in `../../evidence/pq/elysium-99801/hybrid-inputs.json`.
- The deployed profile is `shrincs-256s-keccak-stateful`. It verifies stateful SHRINCS signatures only. Stateless recovery is deliberately disabled.
- The Elysium deployment protects test calendar, session-close, price-attestation and role-key updates. It is not connected to a BELL pool or hook.
- Phase 2 is not deployed. Do not use these addresses on Robinhood Chain Mainnet. A Mainnet release requires a new oracle, hook, factory and governance deployment, exit-invariant testing, independent cryptographic review and exact-match source publication.
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

## Testnet gas evidence

Measured transaction receipt gas for successful hybrid updates:

| Operation | Gas used |
| --- | ---: |
| Calendar root | 324,563 |
| Session close anchor | 324,662 |
| Price attestation | 302,554 |

These are measurements from the recorded Elysium testnet transactions. They are not a Robinhood Mainnet fee estimate. The price test uses deterministic synthetic AAPL data, not a market quote.

The public `/quantum` page links the deployed addresses, accepted update receipts and rejected invalid-ECDSA, invalid-SHRINCS and reused-leaf proofs. Explorer source verification is currently recorded as not verified. Do not describe the system as Mainnet-live, fully quantum-safe, or independently audited.
