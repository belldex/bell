# BELL Smart-Contract Bug Bounty · Draft

**Status:** Draft only · not launched · no payout amount approved.
**Potential platform:** Immunefi or Cantina; the team must choose one and review its rules before publishing.
**Program owner/contact:** Team to provide a monitored security contact and recovery address before launch.

## Scope proposal

The final program should list the exact Robinhood Chain Mainnet (`4663`) addresses and frozen source commit for:

- `BellHookV2` pool hooks
- `BellOpeningAuction` instances and auction registry/factory module
- `BellPoolFactory` and `BellRouter`
- `AssetRegistry`, `CalendarRegistry`, `SessionRegistry`, `SafetyController`
- `BellPolicyOracle`, `BellPolicyDependencyReader`, `BellModeEvaluator`
- per-pool `BellSwapLens` instances after they are deployed and full-match verified

The definitive scope is the address table attached to the platform program. Do not include a contract until its address, source/bytecode status, and owner of response are confirmed. External Uniswap, Robinhood, Permit2, wallet, RPC, oracle-provider, and UI-hosting systems are not BELL-owned scope unless explicitly added with their operator's agreement.

## Eligible impact proposal

Reports should demonstrate a reproducible security impact against an in-scope contract, such as:

- direct loss or unauthorized movement of user/LP/escrow funds;
- funds becoming permanently or materially inaccessible;
- bypass of a configured flow cap, session, auction, authorization, or withdrawal invariant;
- privilege escalation that lets an attacker alter protected policy or ownership;
- a practical attack that makes a core pool or settlement path unavailable beyond intended policy limits.

The final platform scope and severity table control eligibility. UI presentation issues, expected price divergence, unavailable external providers, unproven theoretical paths, and issues with no security impact should not be treated as valid critical reports by default.

## Safe testing rules

- Reproduce issues on a local fork or testnet; do not attack live Mainnet pools, users, or third-party services.
- Do not drain, alter, lock, front-run, or otherwise interfere with real user funds.
- Do not submit transactions that create lasting state changes on Mainnet as a proof of concept.
- Report privately through the selected platform and include the exact commit/address, environment, steps, expected impact, actual result, and a minimal reproducible test.
- Do not publish a vulnerability or identifying details until the team and platform authorize disclosure under their process.
- Do not access, modify, or exfiltrate data outside the agreed contract scope.

## Severity and payout

Use the chosen platform's current severity framework and impact categories. **Reward amounts and maximum payout are intentionally unset** until the team approves a budget, treasury source, eligibility terms, and any KYC/tax requirements. Do not launch a public program with blank or ambiguous payout terms.

## Safe Harbor consideration

SEAL Safe Harbor is a separate, optional framework for pre-authorized whitehat rescue during an active exploit; it is not a replacement for a normal pre-disclosure bug bounty. Adoption requires the team to define covered assets/contracts, rescue address, contact path, identity rules, and bounty terms. The team should review [SEAL Safe Harbor](https://frameworks.securityalliance.org/safe-harbor/overview/) and its [scope terms](https://frameworks.securityalliance.org/safe-harbor/scope-terms/) before deciding whether to adopt it.

## Launch checklist

- [ ] Independent audit engagement completed and remediation retest recorded.
- [ ] `audit-v1` scope, addresses, code match, and known issues published.
- [ ] Program platform, contact and response SLA confirmed.
- [ ] Severity table and payout budget approved by the team.
- [ ] Safe test environment and no-live-funds rules reviewed.
- [ ] Safe Harbor decision recorded separately.
- [ ] Program page and all in-scope addresses reviewed by the team before publication.
