# PUBLIC PositionManager lifecycle — local integration evidence

Status: **M06-02 IN_PROGRESS**. No production deployment, audit, Robinhood fork compatibility, actual Permit2 integration, or public release claim.

## Local integration exercised

`contracts/test/integration/public-lp/PublicPositionManager.t.sol` uses the pinned v4 PoolManager and PositionManager with the candidate BellPoolFactory. It demonstrates actual recipient-held ERC721 positions and exercises:

- user-owned NFT increases and explicit additional mints through PositionManager; seed principal, config, lifecycle, caps and request nonce do not change;
- approved executor/operator and transferred-NFT owner authority; approved executor must fund its own increase and cannot silently spend the NFT owner's Permit2 allowance;
- unauthorized increase/remove/collect and recipient theft rejection, wrong ticks/key/context rejection, deadline/minimum/settlement failure rollback;
- full decrease plus `TAKE_PAIR` returns both currencies in kind while pool/asset pause is active, health/calendar/source dependencies are stale or revert, and the hook is in planned CLOSED with test-injected exhausted budgets;
- zero-liquidity `INCREASE_LIQUIDITY` plus `TAKE_PAIR` collects actually accrued core fees after a **direct core donation**. This is not a swap or a price/oracle bypass; production swap execution remains fail-closed;
- exact hookData rejection; no project custody adapter, wrapped conversion, generic sweep or offchain dependency in LP exit path.

Focused command:

```powershell
$env:PATH = 'C:\Users\sifaq\.foundry\bin;' + $env:PATH
pnpm test:contracts -- --match-path 'test/integration/public-lp/PublicPositionManager.t.sol' -vv
```

Observed result in the full check on 2026-10-27: **53 passed, 0 failed, 0 skipped** in `PublicPositionManagerTest`; the factory suite adds 42 tests. Both suites exercise real pinned core/PositionManager, but share a synthetic Permit2 double and controlled registry/source/safety fixtures. CLOSED/budget exhaustion is test-only state injection; no production swap was used to consume a budget.

## Remaining acceptance

- Pinned Permit2 is represented by a clearly labeled local double; compile/integration against the actual 0.8.17 Permit2 artifact remains outstanding.
- Target Robinhood fork compatibility and funded testnet LP rehearsal remain unverified. M05-05 is not wired into production BellHook; LIVE does not grant swap permission.
- TREASURY_ONLY is a separate M06-03 task and is not implemented by this PUBLIC lifecycle evidence.
- No pool exists on testnet, so none of this has been exercised against a deployed pool. See `docs/CURRENT-STATE.md`.
