/**
 * One-shot reconciliation of evidence/task-status.json to the state traced on 2026-10-27.
 *
 * Only tasks whose evidence actually changed are touched. Nothing is promoted to DONE that does
 * not have a passing artifact. Run through the official sync helper so the plan/brief hashes stay
 * derived from config/release-baseline.json.
 */
import { syncTaskStatus } from './sync-task-status.mjs';

const TRACE_DOC = 'docs/CURRENT-STATE.md';

const updates = {
  // The Yahoo pivot is real, deployed and unit-tested, but the source-rights question it was
  // supposed to answer is still open, so this stays IN_PROGRESS with a corrected blocker.
  'M01-01': {
    blockers: [
      'Source path pivoted from Chainlink Data Streams to public Yahoo Finance charts plus a BELL EIP-712 reporter; the Chainlink catalog/credential evidence below is historical and no longer describes the active path.',
      'Yahoo exposes PRE/REGULAR/POST only. There is no Yahoo feed for the Robinhood OVERNIGHT session, so overnight health cannot be sourced from it.',
      'Data rights and admission remain NOT_VERIFIED / NOT_ADMITTED: config/sources/rights-status.json is still BLOCKED_ACCESS.',
    ],
    evidence: [
      'contracts/src/adapters/YahooSourceVerifier.sol',
      'contracts/src/adapters/YahooAttestedSourceAdapter.sol',
      'contracts/test/unit/adapters/YahooAttestedSourceAdapter.t.sol',
      'packages/protocol/src/yahoo-quote.mjs',
      'packages/protocol/src/yahoo-attestation.mjs',
      'packages/protocol/test/yahoo-attestation.test.mjs',
      'scripts/deploy/deploy-yahoo-verifier.mjs',
      'scripts/deploy/deploy-yahoo-stream-adapters.mjs',
      'scripts/deploy/publish-yahoo-direct.mjs',
      'evidence/deploy/yahoo-verifier-adapter-testnet.json',
    ],
  },

  // Same pivot: canonical token identity is now bound through the Yahoo SourceWire instead of a
  // Chainlink verifier proxy. The AAPL Testnet facade is explicitly not a canonical token.
  'M01-02': {
    blockers: [
      'Same-block RPC agreement verifies observed code/getters only; candidate contract identities, source bindings and source/data-use entitlements remain unadmitted pending review and evidence.',
      'Mainnet AAPL/NVDA/TSLA canonical tokens are verified read-only, but no BELL adapter is deployed on Mainnet, so the canonical binding exists only as a wire hash.',
      'The Testnet AAPL identity is AaplTestnetFacade 0x64a82eb01d7c7310ef1bc5f0055f758409d45c63, which satisfies the adapter constructor code check only. It is not a Robinhood Stock Token and must never be described as one.',
    ],
    evidence: [
      'config/assets/candidates.mainnet.json',
      'packages/domain/src/source-manifest.mjs',
      'packages/domain/test/source-manifest.test.mjs',
      'scripts/discovery/partial-asset-probe.mjs',
      'scripts/discovery/partial-asset-probe.test.mjs',
      'evidence/runtime/asset-candidate-alchemy-partial-2026-10-25.json',
      'evidence/runtime/asset-candidate-dual-provider-2026-10-25.json',
      'evidence/runtime/canonical-token-binding-2026-10-25.json',
      'evidence/runtime/robinhood-official-stock-testnet-availability-2026-10-26.json',
      'evidence/deploy/yahoo-verifier-adapter-testnet.json',
      'docs/CURRENT-STATE.md',
    ],
  },

  // Authenticated RPC probes are done; the entitlement half is what remains.
  'M01-03': {
    blockers: [
      'Both providers are probed and agree at a common block on mainnet and testnet (evidence/runtime/rpc-capability-matrix-2026-10-25.json). What is still missing is source entitlement, not RPC access.',
      'Chainlink Testnet feed access returned Unauthorized because the available credential is mainnet-only. Chainlink is no longer the chosen price path, so this is historical rather than a live blocker.',
    ],
    evidence: [
      'scripts/discovery/rpc-client.mjs',
      'scripts/discovery/rpc-capability-probe.mjs',
      'scripts/discovery/rpc-capability-probe.test.mjs',
      'evidence/runtime/rpc-preflight-mainnet-agree-2026-10-25.json',
      'evidence/runtime/rpc-preflight-testnet-agree-2026-10-25.json',
      'evidence/runtime/rpc-capability-matrix-2026-10-25.json',
      'evidence/runtime/rpc-discovery-pinax-testnet-2026-10-25.json',
      'evidence/runtime/chainlink-testnet-report-entitlement-2026-10-26.json',
      'scripts/deploy/verify-testnet-dual-provider.mjs',
      'evidence/runtime/testnet-dual-provider-status-2026-10-26.json',
    ],
  },

  'M01-05': {
    blockers: [
      'Freshness trace logic is tested, but the live trace still runs against Chainlink-era inputs. It has not been re-pointed at the Yahoo adapter, whose newest sample is already 5500 seconds old and past validUntil.',
      'No Yahoo sample exists for the three stream adapters (scope 1/2/3): readCurrent() reverts WrongAdapterMode because they are not direct mode.',
    ],
    evidence: [
      'packages/domain/src/freshness-trace.mjs',
      'packages/domain/test/freshness-trace.test.mjs',
      'evidence/runtime/freshness-trace-live-2026-10-25.json',
      'evidence/runtime/mainnet-readonly-price-source-review-2026-10-26.json',
      'docs/CURRENT-STATE.md',
    ],
  },

  // Calendar contracts and proof tooling are done and tested; the actual venue schedule is not.
  'M03-05': {
    blockers: [
      'CalendarRegistry, CalendarProof and the builder are implemented and tested, but no real venue schedule has been sourced: holidays, early closes and timezone-database inputs are all missing.',
      'No root is queued for any asset. CalendarRegistry.currentInterval(WETH) reads all zeros, so no stock health can ever become ready.',
      'CalendarRoot year identity is lazily bound on first valid proof use and still needs governance acceptance.',
    ],
  },

  // SessionRegistry now really exists onchain and has accepted zero reports.
  'M14-01': {
    blockers: [
      'Rehearsal bundle is live on chain 46630: 10 contracts plus the 6-decimal mBELL fee token, wired and re-verified against the chain on 2026-10-27 at block 143532008 (evidence/deploy/testnet-46630-verification.json, regenerated by scripts/deploy/verify-testnet-deployment.mjs).',
      'No stock descriptor is admitted. Only the oracleless WETH counterasset is ACTIVE (descriptorId 0x88cb2233..., queue tx 0xdf3e6f6b..., activation tx 0x2c91a85a...). descriptorIdForToken returns zero for the AAPL facade and for mBELL.',
      'No calendar root is committed: CalendarRegistry.currentInterval(WETH) returns session=0, startAt=0, endAt=0, leafHash=0x0. SessionRegistry.health(WETH) is ready=false with refreshedAt=0, i.e. refreshHealth has never succeeded.',
      'SafetyController treasury is the burn address 0x...dEaD, so treasury exit and privilege handover cannot be rehearsed.',
      'The deployed factory profile is PUBLIC-only (liquidityMode=0); TreasuryAdapter is not deployed or bound, so M06-03 has no onchain exercise.',
      'PoolManager ownership is still held by the deployer. No pool has been created and no swap has ever executed; BellHook remains fail-closed (SWAP_EXECUTION_READY=false).',
    ],
    evidence: [
      'contracts/script/DeployTestnet.s.sol',
      'docs/runbooks/testnet-deploy.md',
      'evidence/deploy/testnet-46630.json',
      'evidence/deploy/testnet-46630-verification.json',
      'evidence/deploy/testnet-46630-fee-token.json',
      'evidence/deploy/testnet-46630-asset-queue.json',
      'scripts/deploy/verify-testnet-deployment.mjs',
      'scripts/deploy/check-testnet-addresses.mjs',
      'scripts/deploy/queue-testnet-asset.mjs',
      'scripts/deploy/activate-testnet-asset.mjs',
      'scripts/deploy/verify-testnet-dual-provider.mjs',
      'evidence/runtime/testnet-dual-provider-status-2026-10-26.json',
      'docs/CURRENT-STATE.md',
    ],
  },

  'M14-02': {
    blockers: [
      'The live official Robinhood assets API returns 195 official assets, all on chainId 4663 only. AAPL/TSLA/NVDA have no official 46630 deployment, so no stock can be paired with WETH on testnet.',
      'Yahoo supplies free, fresh public quotes and a BELL reporter can attest them, but the newest onchain sample is 5500 seconds old against a 120-second policy, and no stream-scope sample exists at all.',
      'No funded source/report workload, quota/capacity trace, or create-and-seed session rehearsal has been run. The rehearsal facade is not market or source evidence.',
    ],
    evidence: [
      'evidence/runtime/testnet-dual-provider-status-2026-10-26.json',
      'evidence/deploy/testnet-46630-asset-queue.json',
      'evidence/runtime/robinhood-official-stock-testnet-availability-2026-10-26.json',
      'evidence/deploy/yahoo-verifier-adapter-testnet.json',
      'evidence/runtime/mainnet-readonly-price-source-review-2026-10-26.json',
      'docs/CURRENT-STATE.md',
    ],
  },

  // The swap page and router are real, but nothing sends a transaction.
  'M11-03': {
    blockers: [
      'Build export for Vercel Free and live wallet E2E are still unproven; the §8.5 state machine itself is fully tested.',
      'The swap screen never sends a transaction: apps/web/app/(app)/swap/page.tsx contains no writeContract/sendTransaction, and its CTA stops at "Review & simulate swap".',
      'A full swap flow needs M05-05 execution plus a live M08 quote. BellHook returns executionReady=false, so any real swap would revert HookNotImplemented().',
    ],
  },

  'M06-04': {
    blockers: [
      'Router is deployed at 0x35ce0b38a70c7d3df0d3a33fba2dfdd900298741 and its 10 pinned-core unit/integration tests pass, but no BellRouter.swap transaction has ever been sent because no eligible stock pool exists.',
      'Production BellHook swap callbacks remain fail-closed, so even a seeded pool would not advertise an executable swap until M05-05 lands.',
    ],
  },

  'M09-01': {
    blockers: [
      'keeper-a edge function, fenced no-op ticks and cron invocation are live; the tick deadline/lease/no-op logic is tested.',
      'The keeper is still a no-op for prices. It does not fetch Yahoo quotes, does not call submitReports, and does not call refreshHealth on the testnet SessionRegistry. Nothing keeps a sample fresh: the newest direct sample was already 5500 seconds old against a 120-second policy when traced on 2026-10-27.',
      'The signing path needs a reporter key the keeper can reach. Today the reporter key is only used manually via scripts/deploy/publish-yahoo-direct.mjs, and it must stay separate from governance/treasury.',
      'Receipt reconciliation against the real provider remains unimplemented/unverified.',
    ],
  },

  'M11-01': {
    blockers: [
      'Wallet E2E browser interaction has not been verified (Chrome debug port timed out during test); Vercel static export/deployment not verified.',
      'The testnet banner and homepage do correctly state rehearsal-only status, that production swaps are not enabled, and that Mainnet release has not been approved. A source-level test (apps/web/test/homepage.test.mjs) now guards those claims from regressing into marketing copy.',
      'The app never sends a transaction: no screen calls writeContract or sendTransaction. Read-only status comes from readTestnetStatus, which pins every read to one block and re-checks block hash and chainId at the end.',
    ],
  },

  // Invariants now include the closure FSM; keep the artifact list honest.
  'M13-02': {
    evidence: [
      'contracts/test/invariant/treasury/TreasuryAdapterInvariants.t.sol stateful randomized sequence 100k runs: in-kind conservation, core principal accounting, unsweepable foreign balances, zero-success unauthorized attempts, exact treasury debit',
      'contracts/test/invariant/closure/BellHookClosureStatefulInvariants.t.sol seeded 12-step randomized closure FSM 100k runs: single latch per episode, monotone closure nonce, episode gross bounded by caps and never refilled, canonical anchor-to-leaf binding, recovery candidate invariants, policy/state mode parity, swap fail-closed in every reachable state',
      'pnpm check 2026-10-27: 280 node:test, 45+18 reference, 351 forge tests across 27 suites (incl. both invariant suites), Deno 15, keeper-b 6, wrangler dry-run, abi:check, evidence:check, secret boundary all green',
    ],
  },

  'M13-05': {
    blockers: [
      'The descriptive release index (evidence/release-index.json) was stale: superseded brief/plan hashes, 316/243 test counts from an older run, and a Chainlink-era VERIFIED_ACCESS claim. Nothing read it, so it rotted silently. It is now validated by check-release.mjs together with the machine-read evidence/releases/index.json.',
      'The bundle is still not reviewable by an outsider: E01-E06 are all NOT_RUN, and the evidence index carries MISSING/NOT_RUN on purpose. RC final waits on M13-01/M13-02/M13-03 and M14.',
    ],
    evidence: [
      'evidence/release-index.json',
      'evidence/releases/index.json',
      'config/release-baseline.json',
      'scripts/evidence/check-release.mjs',
      'docs/CURRENT-STATE.md',
    ],
  },
};

const result = await syncTaskStatus(updates);
console.log(`reconciled ${Object.keys(updates).length} tasks; catalog ${result.planTaskCount}`);
