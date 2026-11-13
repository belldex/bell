# Bell State Hooks v2 — feasibility and deployment gate

**Snapshot:** 13 November 2026
**Scope:** The post-quantum trust-input work in `Einstein Hooks v2.md`
**Decision:** Ship the `/quantum` research page with `RESEARCH · PLANNED`; do not deploy a PQ verifier or hook until an eligible implementation and its integration are independently reviewed.

## Why no PQ contract was deployed

1. NIST has standardized SLH-DSA in [FIPS 205](https://csrc.nist.gov/pubs/fips/205/final). A standard defines the signature algorithm; it does not provide a reviewed Solidity verifier or prove that one fits the target chain's gas limits.
2. Elysium is an Arbitrum Orbit chain. Its launch material describes standard Solidity/EVM compatibility and says custom precompiles are planned for a later upgrade, for HyperCore integrations. It does not document a post-quantum signature precompile. See the [Arbitrum announcement](https://blog.arbitrum.io/elysium-joins-the-programmable-economy/).
3. Public EVM verifier candidates found during this review are explicitly research code without an independent audit. For example, Fireblocks' [ML-DSA-44 EVM verifier](https://github.com/fireblocks-labs/evm-ml-dsa-verifier) reports 1,226,311 gas for verification and explicitly says it has not been audited. It uses lattice-based ML-DSA, not the hash-based route selected in the BELL brief. It is not a drop-in choice for this phase.
4. Public Winternitz/XMSS-style code is not enough by itself. A one-time key can authorize only one signature; the signer must durably reserve an index before signing and reconcile it with chain state. A mistake can compromise future signatures. The [Winternitz testnet project's security notes](https://www.winternitz.app/docs/security) say its verifier has not been independently audited and that XMSS remains future work. The reviewed candidate set did not provide an independently audited, production-suitable EVM verifier plus the safe signer/index-custody design required by the brief.

Implementing a verifier locally, copying an unaudited research implementation, or relabeling an ordinary Keccak/WOTS construction as a standardized PQ scheme would violate the brief's instruction not to invent the cryptography. No Elysium or Robinhood Chain transaction was sent for this feature.

## Scope completed in this pass

- Added the statically rendered `/quantum` page and an app navigation entry.
- Chose **Bell State Hooks** as the displayed working name, following the brief's recommendation. This page labels the work as planned research, not a live security feature.
- Documented the protected trust inputs and explicitly excluded ordinary user-wallet signatures and LP withdrawals.
- Kept testnet and Mainnet phases separate. The page contains no fake contract addresses, gas figures, deployment transactions, audit claims, or pool claims.
- Added page-content and responsive/reduced-motion source checks.

## Elysium testnet wallet preflight

Checked against the Elysium testnet RPC (`eth_chainId = 99801`) on 13 November 2026:

- `ELYSIUM_DEPLOYER_PRIVATE_KEY` is configured; its derived account held **0.185702 HYPE** at the check. This is testnet HYPE, not a Mainnet balance.
- Guardian, treasury, service, and reporter key variables are configured. The guardian, treasury, and service private keys derive the same addresses as their corresponding configured role addresses.
- The current deployment script assigns governance to the deployer when `ELYSIUM_GOVERNANCE_ADDRESS` is absent. No Elysium reporter address variable is configured.
- No transaction was broadcast for this feature. The existing `DeployTestnet.s.sol` deploys the current BELL stack, not the PQ verifier, registry, or HybridAuth described here. Funding is therefore not the blocker; there is no eligible reviewed implementation to deploy.

## Gates before Phase 1 testnet

- Select an implementation of a published hash-based signature standard and pin its exact source revision, license, test vectors, threat model, and code identity.
- Complete an independent cryptographic review of the verifier and a separate integration review of role binding, domain separation, key revocation/rotation, Merkle proofs, and replay/index handling.
- Define signer custody and an atomic, durable one-time-key index reservation/recovery process. Reconcile reserved indices against onchain consumed indices before every signature.
- Implement HybridAuth so privileged updates require both the existing ECDSA authorization and the PQ authorization. Scope each signature to chain, verifier, role, action, target, nonce/index, and expiry.
- Keep the hook permission mask free of remove-liquidity permissions, and fuzz the invariant that PQ verifier failure cannot block `removeLiquidity`.
- Run Elysium testnet valid/invalid/reused-signature tests; record successful update receipts, rejected attack receipts, and actual gas. Do not copy gas figures from another EVM chain.

## Gates before Phase 2 Mainnet

- Phase 1 passes with reproducible evidence and no unresolved critical/high security findings.
- Independent review covers the complete onchain and offchain signing path; accepted fixes are retested.
- Deploy new immutable v2 registries, oracle, hook template, and factory only after a pinned dry-run. Existing pools cannot acquire a new immutable hook; any migration is a separate withdraw-and-reseed decision.
- Verify every deployed source exactly and publish addresses, transactions, configuration hashes, and the LP-exit invariant test results.

## References checked

- NIST, [FIPS 205 — Stateless Hash-Based Digital Signature Standard](https://csrc.nist.gov/pubs/fips/205/final).
- Arbitrum, [Elysium joins the programmable economy](https://blog.arbitrum.io/elysium-joins-the-programmable-economy/), 9 November 2026.
- Fireblocks Labs, [EVM ML-DSA verifier source and limitations](https://github.com/fireblocks-labs/evm-ml-dsa-verifier), checked 13 November 2026.
