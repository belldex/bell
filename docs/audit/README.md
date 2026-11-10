# BELL Mainnet Audit Package · Draft

**Prepared:** 10 November 2026
**Status:** Internal audit package draft. No independent audit is complete, booked, or implied by these materials.
**Chain:** Robinhood Chain Mainnet · `4663`
**Review candidate:** freeze a final, reviewed commit as `audit-v1` after the Lens, UI, evidence, and test changes are accepted.

## What this package contains

- [Architecture and trust boundaries](./architecture.md)
- [Explicit security invariants and linked tests](./invariants.md)
- [Opening Bell Auction lifecycle](./auction-flow.md)
- [Scope, deployments, dependencies, and known issues](./scope-and-known-issues.md)
- [Reproducible test commands](./run-tests.md)
- [Auditor shortlist and official request paths](./auditor-candidates.md)
- [Bug bounty program draft](../bug-bounty/draft.md)

The exact source commit, Solidity/Foundry versions, `foundry.toml`, deployed addresses, constructor bindings, and verification status must be copied into the final tagged package after the release candidate is frozen. Mainnet addresses and receipts are sourced from [`evidence/deploy/mainnet-4663.json`](../../evidence/deploy/mainnet-4663.json), [`evidence/deploy/mainnet-4663-verification.json`](../../evidence/deploy/mainnet-4663-verification.json), the public pool/receipt endpoints, and Blockscout.

## Review request

Ask the selected auditor to review the exact tagged commit and deployed bytecode, including the hook, auction and Lens behavior. Provide the named out-of-scope list and every known limitation before the engagement starts. Do not describe internal tests or this package as an audit.
