# End-to-end Testnet Execution — Evidence and How to Rerun

Tanggal: 2026-10-28. Chain: Robinhood Testnet (46630).

This document records **what actually happened on-chain**, not a plan.

---

## Hasil

| Tahap | Status | Bukti |
|---|---|---|
| Deploy stack 10 kontrak | ✅ | `evidence/deploy/testnet-46630.json`, 11 alamat ber-kode |
| Deploy stock token + 3 adapter Yahoo | ✅ | `evidence/deploy/testnet-stock-adapters.json` |
| Admit WETH + stock descriptor | ✅ | `evidence/deploy/testnet-46630-asset-queue.json` |
| Calendar root + interval | ✅ | interval aktif, phase REGULAR |
| Health ready, reasonBits 0 | ✅ | `SessionRegistry.health` = ready |
| Pool pertama create + seed | ✅ | tx `0x7c1542eb…` block `143921854` |
| **Swap pertama** | ✅ | tx `0x75243421…` block `143926986` |

---

## Script sequence (rerunnable)

```bash
# 1. Deploy the full stack
node scripts/deploy/deploy-testnet.mjs

# 2. Deploy the stock token and Yahoo adapters bound to it
node scripts/deploy/deploy-testnet-stock-and-adapters.mjs

# 3. Admit the WETH counterasset and stock descriptor
node scripts/deploy/admit-testnet-assets.mjs

# 4. Calendar root + interval, publish quote, submit report, refresh health
node scripts/deploy/setup-calendar-and-price.mjs

# 5. Publish a fresh quote and refresh health (also used by step 6)
node scripts/deploy/refresh-stock-health.mjs

# 6. Create and seed the first pool
node scripts/deploy/create-testnet-pool.mjs

# 7. Execute an on-chain swap
node scripts/deploy/execute-testnet-swap.mjs
```

---

## Issues discovered during execution

All have been fixed in the code/scripts and are documented to prevent recurrence.

1. **The JS codec rejected `SourceWire` schema 12.** The validator in `packages/protocol/src/source-codec.mjs`
   accepted only schema 11, while `AssetRegistry` accepts 11 and 12. As a result, encoding
   `sourceConfig` for the Yahoo adapter failed before submission.
2. **The `CalendarRoot` field order was wrong in the script ABI.** The struct places `datasetHash` at the end, not
   after `root`. `queueRoot` reverted until the ABI was fixed and read directly from the artifact.
3. **`settle()` without `sync()` → `CurrencyNotSettled()`.** `PoolManager` calculates reserves from
   balance differences; without `sync` before the transfer, settlement failed. `TestnetSwapExecutor` now
   calls `sync` first.
4. **`activatePool` requires `healthySince` to be at least 60 seconds old.** A pool cannot be activated immediately
   with a single quote. The script publishes two spaced quotes, checkpoints `refreshState` between them,
   then waits 65 seconds for recovery to complete.
5. **`ModePolicy` keeps the pool in RECOVERING while a candidate is running.** `refreshState` must
   be called twice: once to start the candidate and again to complete it after the observation advances
   and 60 seconds have elapsed.
6. **`BellHook` was only 5 bytes below the EIP-170 limit.** Inline swap glue grew it to 30,128 bytes. Solution:
   evaluasi policy pindah ke `BellPolicyOracle` lewat STATICCALL. Hook 23.842 byte, oracle 19.892.
7. **Hook initcode at 63,221 bytes exceeded EIP-3860.** The oracle is deployed once per deployment, not
   per hook. Initcode turun ke 43.630.

---

## What the first swap proves

- `beforeSwap` mengembalikan `lpFeeUnits | OVERRIDE_FEE_FLAG`, jadi fee mengikuti sesi (REGULAR),
  rather than a static fee.
- `afterSwap` validates the actual delta from core, not a user-provided value.
- Budget benar-benar ditulis: `currentGross` `[0,0] → [5,3]`, `rollingRemaining` `[100,100] → [95,97]`.
- The hook rejects swaps when policy is unhealthy—demonstrated repeatedly during preparation while
  `canSwap` was still `false` and the transaction could not be prepared.

---

## Remaining limitations

- Only **SESSION_ONLY**. `PRICE_GUARDED` is rejected with `PRICE_INPUT_INVALID_OR_STALE` because
  no reference pair has been admitted and `referenceMode` has no numeric mapping yet.
- The testnet stock token is a **rehearsal token**, not an official Robinhood Stock Token. The official API
  lists 195 assets, all on chainId 4663 only.
- No Mainnet transactions have occurred.
- The frontend does not submit transactions; the price keeper is still a no-op.
