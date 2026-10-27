/**
 * Close M05-05. Swap enforcement is implemented and covered by a positive test, so the task is DONE
 * for SESSION_ONLY. PRICE_GUARDED remains out of scope and is recorded as a separate, explicit
 * limitation rather than a blocker on this task.
 */
import { syncTaskStatus } from './sync-task-status.mjs';

const updates = {
  'M05-05': {
    status: 'DONE',
    blockers: [],
    evidence: [
      'contracts/src/BellHook.sol — SWAP_EXECUTION_READY = true; _beforeSwap prepares a pinned snapshot and returns lpFeeUnits | OVERRIDE_FEE_FLAG; _afterSwap settles actual core deltas and commits both budget candidates',
      'contracts/src/BellPolicyOracle.sol — stateless STATICCALL-only transport for the full policy evaluation; moved out of the hook to fit EIP-170 (hook 23,842 B / 24,576 B, oracle 19,892 B)',
      'contracts/test/unit/hook/BellHookLifecycle.t.sol::testHealthySyntheticLiveAdvertisesExecutionAndPreparesSwap — first positive swap test: LIVE + healthy SESSION_ONLY pool really produces a snapshot and a fee override',
      'contracts/src/BellModeEvaluator.sol — prepare/settle arithmetic, including validateActual exact-in/out and partial-fill bounds',
      'contracts/test/integration/swaps/BellSwapEvaluator.t.sol',
      'contracts/test/integration/swaps/CoreSwapPolicy.t.sol — 14 tests against the real pinned PoolManager',
      'contracts/test/integration/factory/BellPoolFactory.t.sol',
      'evidence/swap-policy-integration.md',
      'docs/M05-05-swap-execution.md',
      'pnpm check 2026-10-27: 351 forge tests across 27 suites including both 100k-run invariant suites',
    ],
  },

  // Record the deliberate scope boundary on the class that is still closed.
  'M06-04': {
    blockers: [
      'Router is deployed at 0x35ce0b38a70c7d3df0d3a33fba2dfdd900298741 and its 10 pinned-core unit/integration tests pass, and BellHook now advertises execution for SESSION_ONLY pools. What is still missing is a live pool: no stock descriptor is admitted and no calendar root is committed, so no BellRouter.swap can be exercised on chain.',
      'PRICE_GUARDED pools remain non-executable by design: referenceMode has no numeric mapping and no admitted reference pair exists, so the hook rejects that class with PRICE_INPUT_INVALID_OR_STALE.',
    ],
  },

  'M11-03': {
    blockers: [
      'Build export for Vercel Free and live wallet E2E are still unproven; the §8.5 state machine itself is fully tested.',
      'The swap screen never sends a transaction: apps/web/app/(app)/swap/page.tsx contains no writeContract/sendTransaction, and its CTA stops at "Review & simulate swap". Wiring it needs a live quote (M08) and a pool that exists.',
      'The hook now supports swaps for SESSION_ONLY pools, so this is a frontend/quote gap rather than a contract gate.',
    ],
  },
};

const result = await syncTaskStatus(updates);
console.log(`M05-05 closed; catalog ${result.planTaskCount}`);
