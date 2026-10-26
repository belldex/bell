# M06-03 TreasuryAdapter — partial local evidence

Status: **IN_PROGRESS**. The adapter and local core integration are implemented, but the current `BellPoolFactory` explicitly accepts PUBLIC only and does not invoke `TreasuryAdapter.seed`; therefore the end-to-end treasury create-and-seed path is **not integrated**.

## Local behavior exercised

`contracts/test/integration/treasury/TreasuryAdapter.t.sol` uses the pinned `PoolManager`, an actual `BellHook` with `TREASURY_ONLY`, and a one-shot test seed factory. It checks:

- seed call restricted to the immutable factory and only once; hook↔adapter/config binding;
- treasury-funded seed settles through real core, records position key/ticks/salt/liquidity/principal, refunds unused treasury funds, and leaves no adapter dust;
- only immutable treasury can remove/collect; exits are in-kind to an immutable recipient, deadline-bound and do not alter hook seed/budget state;
- oracle/session registry reads may be unavailable during exit;
- output minima on removal are checked against principal (`delta - feesAccrued`) while returned/output credits include accrued fees;
- exact received/debited balance checks reject sender-tax/recipient-undercredit tokens and do not consume unrelated adapter balances;
- no generic sweep/arbitrary target or customer NFT custody exists.

The fee-minima regression test observed RED before the fix: accrued fees allowed a total-output check to pass despite a principal-only minimum failure. The core-take undercredit test likewise failed before requiring exact adapter balance credit.

Focused command (from BELL, PowerShell):

```powershell
$forge = 'node_modules/.pnpm/@foundry-rs+forge-win32-amd64@1.7.1/node_modules/@foundry-rs/forge-win32-amd64/bin/forge.exe'
& $forge test --root contracts --match-contract TreasuryAdapterTest -vv
```

Latest focused result: **10 passed, 0 failed, 0 skipped**. This verifies the adapter in a test-only factory context, not the production factory's atomic TREASURY_ONLY integration.

## Remaining acceptance

- `BellPoolFactory` rejects `TREASURY_ONLY` and does not call `TreasuryAdapter.seed`; add a request-bound atomic factory path that proves hook address, `requestHash`, seed receipt, actual principal and activation ordering.
- Treasury/factory/recipient deployment manifest, actual source and registry dependencies, real chain/fork compatibility and independent review/audit are not supplied.
- No treasury deployment or transaction broadcast was performed; E01–E06 remain `NOT_RUN`.
