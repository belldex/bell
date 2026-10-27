# M06-03 TreasuryAdapter — partial local evidence

Status: **IN_PROGRESS**. The adapter and local core integration are implemented, and `BellPoolFactory` now does call `TreasuryAdapter.seed` for `TREASURY_ONLY` profiles (`testTreasuryOnlyFactoryCanCreateAndSeedPool`). What is still missing is any onchain exercise: the deployed testnet factory is PUBLIC-only with `treasuryAdapter = 0`, so no TreasuryAdapter has ever been deployed or called on a live chain. The path is implemented, not rehearsed.

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

Latest focused result on 2026-10-27: **10 passed, 0 failed, 0 skipped** for `TreasuryAdapterTest`, plus `testTreasuryOnlyFactoryCanCreateAndSeedPool` in `BellPoolFactoryTest` proving the factory's atomic request-bound TREASURY_ONLY path. This still does not constitute a live treasury deployment.

## Remaining acceptance

- The factory's TREASURY_ONLY path is implemented and locally tested, but it has never run against a deployed TreasuryAdapter. Deploy one and exercise seed/exit on chain 46630.
- Treasury/factory/recipient deployment manifest, actual source and registry dependencies, real chain/fork compatibility and independent review/audit are not supplied.
- No treasury deployment or transaction broadcast was performed; E01–E06 remain `NOT_RUN`.
- SafetyController treasury is the burn address `0x...dEaD`, so treasury exit and handover cannot be rehearsed at all yet.
