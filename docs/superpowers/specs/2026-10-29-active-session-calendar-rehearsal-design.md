# Active-Session Calendar Rehearsal Design

## Goal

Allow a fresh Robinhood testnet rehearsal asset to get a valid calendar interval and Yahoo report for the market phase active onchain now, without modifying an existing asset's committed calendar root or mislabeling Yahoo phases.

## Current Evidence and Root Cause

- The previous rehearsal asset's committed root contains PRE index 0 followed by REGULAR index 1. Its PRE interval ended at chain time `1793194200`; `currentInterval()` correctly returns the zero leaf after that boundary until index 1 is activated.
- The old asset's REGULAR leaf remains visible through `nextInterval()`, but the attempted `activateInterval` simulation failed. The available logs do not establish a valid inclusion proof for that root, so the old calendar must not be bypassed or rewritten.
- A new stock token was deployed and admitted at descriptor `0x99525af3649889aa1ea9c274ebca4838b83f8816185b9257919c603ef6266139`. The current testnet session is REGULAR and Yahoo supplied a fresh REGULAR quote during investigation.
- The current calendar setup script hardcodes a PRE-to-REGULAR interval and refuses to run after 13:30 UTC. It must construct a calendar for the active market phase instead.

## Design

For the fresh asset only, determine the calendar leaf from chain time and the freshly fetched Yahoo phase. The supported rehearsal phases are PRE, REGULAR, and POST, mapped to their already-admitted extended, regular, and extended wires respectively. The interval must cover chain time, bind the new asset/year/index/provenance/registry/chain, and use an end boundary no later than the next real session transition (or the configured finite rehearsal horizon when no later transition is available).

Before any write, validate quote freshness and phase equality, derive and locally verify the calendar proof/root, and call `simulateContract` for root admission/activation, interval activation, direct report publication, stream report submission, and health refresh. Do not broadcast a transaction whose simulation fails. After successful writes, read back the active interval, report phase, health, and pool policy from chain. Keep the old asset's evidence as historical evidence; update the current evidence files only after onchain reads match the new deployment.

No operation may rewrite or relabel the old root, submit PRE data as REGULAR, or claim `canSwap=true` without an onchain policy read.

## Components and Checks

- `scripts/deploy/setup-calendar-and-price.mjs`: active-phase selection, fresh evidence checks, valid root/proof construction, simulations before broadcasts, post-write reads.
- `scripts/deploy/keeper-price-config.mjs` and its tests: pure phase/calendar mapping and interval-boundary assertions where shared logic is needed.
- `scripts/deploy/final-testnet-acceptance.mjs`: run with the expected active phase and require calendar, report, health, policy, and prior swap checks to match onchain state.
- Test first: unit-test phase-to-wire/phase-to-calendar mapping and reject stale or mismatched Yahoo quotes; run integration simulations before any calendar/report transaction.

## Safety and Failure Behavior

All operations target only the newly admitted asset and its recorded adapters. A stale quote, unsupported phase, invalid root/proof, phase mismatch, or failed simulation stops the script before broadcast and preserves existing evidence. If any post-broadcast readback disagrees, stop and report the transaction hashes and observed chain state; do not create another asset automatically.

## Acceptance Criteria

1. The selected calendar interval covers the observed chain timestamp and has the same phase as the fresh Yahoo quote.
2. The report uses the adapter/feed admitted for that phase; no phase relabeling occurs.
3. Calendar and report simulations pass before their transactions are sent.
4. Final read-only acceptance confirms the new descriptor, active interval, phase-matched fresh report, ready health, policy, and at least one verified swap.
5. Existing pool/root evidence remains available and is not overwritten with claims about the new pool.
