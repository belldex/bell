/**
 * Close the tasks proven by the 2026-10-28 end-to-end testnet run.
 *
 * Every entry here has an onchain transaction hash or a verified state read backing it.
 * Nothing is promoted without that evidence.
 */
import { syncTaskStatus } from './sync-task-status.mjs';

const updates = {
  'M06-01': {
    status: 'DONE',
    blockers: [],
    evidence: [
      'contracts/src/BellPoolFactory.sol — atomic createAndSeed for PUBLIC (via PositionManager) and TREASURY_ONLY (via TreasuryAdapter.seed)',
      'contracts/test/integration/factory/BellPoolFactory.t.sol — 42 tests against the real pinned PoolManager and PositionManager',
      'evidence/deploy/testnet-pool-created.json — FIRST LIVE POOL on chain 46630: hook 0x60ebf7082ea56a6956af5a137a2ae50937162cc0, poolId 0x01ca38d9ebfc30a7387a07f4b41d9b947ed3b520f78bb28690c17f82ddcdeaed, create tx 0x7c1542eb6d7c7d0665ba520449e07fd0668c439a5e0f422fae8aba312a17c568 at block 143921854, lifecycle LIVE, mode ACTIVE, canSwap true',
      'scripts/deploy/create-testnet-pool.mjs — reproducible creation runner including salt mining and health precondition',
      'evidence/factory-atomic-results.md',
      'docs/CURRENT-STATE.md',
    ],
  },

  'M06-04': {
    status: 'DONE',
    blockers: [],
    evidence: [
      'contracts/src/BellRouter.sol — zero-custody direct swap with caller=payer, monotonic nonces, deadline and slippage bounds',
      'contracts/test/integration/router/BellRouter.t.sol — 10 pinned-core unit/integration tests',
      'evidence/deploy/testnet-swap-executed.json — FIRST LIVE SWAP on chain 46630: tx 0x75243421ed21adcd8e233e129bb0346cab0ea47af1c907e18c0e703117ecb830 at block 143926986, 5 token0 in and 3 token1 out, hook budget committed [5,3], rolling remaining [95,97]',
      'contracts/src/fixtures/TestnetSwapExecutor.sol — rehearsal executor proving the hook callbacks fire on a live pool',
      'scripts/deploy/execute-testnet-swap.mjs',
      'docs/CURRENT-STATE.md',
    ],
  },

  'M14-01': {
    blockers: [
      'Rehearsal stack is live on chain 46630 and now carries a real pool and a real swap. 10 protocol contracts plus mBELL fee token, AAPL rehearsal stock token, Yahoo verifier and three Yahoo adapters are all deployed and verified onchain (manifest hash 0xcbdecf25eba7ec6df7787382e65779d49a651aee9a6ce698e62c2907fccb2179).',
      'First pool is LIVE at hook 0x60ebf7082ea56a6956af5a137a2ae50937162cc0 (create tx 0x7c1542eb...) and the first swap executed at tx 0x75243421... with budget committed.',
      'SafetyController treasury is still the burn address 0x...dEaD, so treasury exit and privilege handover cannot be rehearsed.',
      'The deployed factory profile is PUBLIC-only (liquidityMode=0); TreasuryAdapter is not deployed or bound.',
      'PoolManager ownership is still held by the deployer. PRICE_GUARDED remains non-executable by design.',
      'Only SESSION_ONLY is executable: referenceMode has no numeric mapping and no admitted reference pair exists.',
    ],
    evidence: [
      'contracts/script/DeployTestnet.s.sol',
      'docs/runbooks/testnet-deploy.md',
      'evidence/deploy/testnet-46630.json',
      'evidence/deploy/testnet-46630-verification.json',
      'evidence/deploy/testnet-stock-adapters.json',
      'evidence/deploy/testnet-46630-asset-queue.json',
      'evidence/deploy/testnet-pool-created.json',
      'evidence/deploy/testnet-swap-executed.json',
      'scripts/deploy/verify-testnet-deployment.mjs',
      'scripts/deploy/check-testnet-addresses.mjs',
      'scripts/deploy/deploy-testnet-stock-and-adapters.mjs',
      'scripts/deploy/admit-testnet-assets.mjs',
      'scripts/deploy/setup-calendar-and-price.mjs',
      'scripts/deploy/refresh-stock-health.mjs',
      'scripts/deploy/create-testnet-pool.mjs',
      'scripts/deploy/execute-testnet-swap.mjs',
      'docs/CURRENT-STATE.md',
    ],
  },

  'M14-02': {
    blockers: [
      'A full create-and-seed-and-swap session rehearsal has now been conducted on chain 46630: calendar interval committed, SessionRegistry health ready with reasonBits 0, pool created and seeded, and a swap executed with budget committed.',
      'The official Robinhood assets API still lists all 195 official assets on chainId 4663 only, so the testnet stock leg is a clearly labelled rehearsal token, not a canonical Robinhood Stock Token.',
      'No capacity/quota trace has been measured against the candidate; the source feed is updated by script rather than by a running keeper.',
    ],
    evidence: [
      'evidence/runtime/testnet-dual-provider-status-2026-10-26.json',
      'evidence/deploy/testnet-46630-asset-queue.json',
      'evidence/runtime/robinhood-official-stock-testnet-availability-2026-10-26.json',
      'evidence/deploy/yahoo-verifier-adapter-testnet.json',
      'evidence/deploy/testnet-stock-adapters.json',
      'evidence/deploy/testnet-pool-created.json',
      'evidence/deploy/testnet-swap-executed.json',
      'evidence/runtime/mainnet-readonly-price-source-review-2026-10-26.json',
      'docs/CURRENT-STATE.md',
    ],
  },

  'M03-05': {
    blockers: [
      'CalendarRegistry, CalendarProof and the builder are implemented and tested, and a real root plus interval is now committed on chain 46630 for the rehearsal stock asset (coverage 2026-10-28 onward).',
      'The committed schedule is a rehearsal interval, not sourced exchange data: real holidays, early closes and timezone-database inputs are still missing, so the calendar cannot be used for production admission.',
      'CalendarRoot year identity is lazily bound on first valid proof use and still needs governance acceptance.',
    ],
  },
};

const result = await syncTaskStatus(updates);
console.log(`closed end-to-end tasks; catalog ${result.planTaskCount}`);
