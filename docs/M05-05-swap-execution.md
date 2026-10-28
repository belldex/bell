# M05-05 — Swap Execution: Complete, and How It Works

Status: **implemented**. `BellHook.SWAP_EXECUTION_READY = true`, `_beforeSwap`/`_afterSwap` actually
prepare and settle swaps. This document replaces the previous version, which reported the feature as blocked.

---

## 1. Blocker lama: EIP-170

`BellHook` was 24,571 bytes against a 24,576-byte limit—**only 5 bytes remained**. Adding swap glue
directly to the hook resulted in 30,128 bytes, exceeding the limit by 5,552. Therefore, logic could not be
added without first freeing space.

## 2. Solusi: pindahkan evaluasi policy ke kontrak terpisah

The new **`BellPolicyOracle`** contract handles all evaluation:

- all dependency reads (`pauseState`, `descriptor`, `health`, `currentInterval`,
  `nextInterval`, `anchorStatus`, `latestSample`) with the same fixed buffers and gas cap;
- agregasi reason per aset;
- `ModePolicy` decisions (mode, latch, closure nonce, recovery vector);
- proyeksi `PolicyView` (cap efektif, rolling/closure remaining, validUntil).

The hook calls it via **STATICCALL**, not delegatecall—so the oracle can only respond; it cannot write,
modify, or authorize. The hook remains the owner of all state: `_state`, `_buckets`, `_episodeGross`, and all checkpoints.

### Hasil ukuran

| Kontrak | Runtime | Margin EIP-170 |
|---|---:|---:|
| BellHook | 23.842 | 734 |
| BellPolicyOracle | 19.892 | 4.684 |
| BellHookDeployer | 3.116 | 21.460 |
| BellModeEvaluator | 14.115 | 10.461 |
| BellPoolFactory | 16.877 | 7.699 |

The oracle is deployed **once per deployment**, not per hook, keeping each hook's initcode below
the EIP-3860 limit (63,221 bytes previously, 43,630 now).

## 3. What actually happens during a swap now

`_beforeSwap`:
1. `_requireBoundKey` — the key must match this exact pool.
2. `hookData` must be empty; references/policy never come from the user.
3. `policyOracle.prepareSwap(...)` → full evaluation; reject if `canSwap == false` with
   `PolicyBlocked(reasonBits)`.
4. Only `SESSION_ONLY` is allowed; `PRICE_GUARDED` is rejected with
   `PRICE_INPUT_INVALID_OR_STALE` because no reference pair has been admitted.
5. `BellModeEvaluator.prepare` membangun snapshot: fee per sesi, cap efektif, deteksi repricing,
   corporate-action guard. The snapshot is stored with the callback hash.
6. Return `lpFeeUnits | OVERRIDE_FEE_FLAG` so core uses the session fee instead of a static fee.

`_afterSwap`:
1. The callback hash must match; without a successful `beforeSwap` → `ContextMismatch`.
2. `settleSwap` validates the actual delta (`validateActual`) and price path, then calculates rolling +
   episode candidates **before** writing anything.
3. The hook writes `_buckets`, and `_episodeGross` only if the pool is CLOSED.
4. The snapshot is deleted and the callback hash is zeroed—it cannot be reused.

## 4. Real bugs found during implementation

These were real issues; all were caught by tests and fixed.

1. **`closureRemaining` was reported as full even though no episode existed.** The oracle returned the remaining
   budget when `closureNonce == 0`, advertising capacity that did not exist.
2. **The pool pause nonce used the wrong address.** The oracle used `poolId` as the target address for
   `SafetyController`, but it should have used the hook address. As a result, pool pauses were never read.
3. **`rollingRemaining` ignored `previousGross`.** Only `currentGross` was subtracted, making the
   budget appear larger than it actually was.
4. **The checkpoint hash did not use `nextState` when releasing the latch.** The published hash did not
   match the state actually written.
5. **The `_activate()` test fixture wrote `bellStart` to the wrong slot.** Tests described as
   "activated" had never actually activated; they passed only because the old gate always rejected.

## 5. Honest scope

What **has** been proven:

- `testHealthySyntheticLiveAdvertisesExecutionAndPreparesSwap` — pool LIVE + sehat benar-benar
  produces a swap snapshot and fee override. This is the first positive test in the repo.
- `testAfterSwapWithoutPreparedSnapshotIsRejected` — settlement without a snapshot is rejected.
- 351 forge tests passing, including two invariant suites with 100k runs.

What has **not** been proven:

- `PRICE_GUARDED` remains blocked. It requires an admitted reference pair, and `referenceMode` has no
  numeric mapping yet. Enabling it now would mean inventing a price band.
- No real testnet swap has occurred. This requires an actually created pool and is waiting on a
  stock descriptor + calendar root.
- No hot-path gas benchmark against the release target has been run.
