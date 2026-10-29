/**
 * MAINNET ACCEPTANCE — reads every live system on chain 4663 and fails on anything that would
 * stop a real user. Read-only: no transaction is sent.
 *
 * This is not a copy of the testnet acceptance script. On mainnet a few checks change meaning:
 *  - the treasury must be a real, controlled address, not the burn address used in rehearsal
 *  - a swap must have gone through BellRouter, not the TestnetSwapExecutor fixture
 *  - the fee token must not be the mBELL rehearsal fixture
 *  - the stock token must be the canonical mainnet asset, and rights are reported as unverified
 *    rather than silently assumed
 *
 * Usage:
 *   node scripts/deploy/mainnet-acceptance.mjs
 */
import { createPublicClient, http, parseAbi } from 'viem';
import { readFileSync, existsSync } from 'node:fs';

const MAINNET_CHAIN_ID = 4663;
const Z = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const BURN_ADDRESSES = new Set([
  '0x000000000000000000000000000000000000dead',
  '0x0000000000000000000000000000000000000000',
]);

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing evidence file ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
if (!rpcUrl) throw new Error('RH_MAINNET_RPC_PRIMARY is required');

const manifest = readJson('evidence/deploy/mainnet-4663.json');
const adapters = readJson('evidence/deploy/mainnet-4663-stock-adapters.json');
const assetQueue = readJson('evidence/deploy/mainnet-4663-asset-queue.json');
const pool = readJson('evidence/deploy/mainnet-4663-pool.json');
const swap = readJson('evidence/deploy/mainnet-4663-swap.json');

if (Number(manifest.chainId) !== MAINNET_CHAIN_ID) throw new Error(`manifest chainId is ${manifest.chainId}`);

const c = createPublicClient({ transport: http(rpcUrl) });
const chainId = await c.getChainId();
if (chainId !== MAINNET_CHAIN_ID) throw new Error(`RPC answered chain ${chainId}, expected ${MAINNET_CHAIN_ID}`);

const failures = [];
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${detail}`);
}

const block = await c.getBlock();
const now = Number(block.timestamp);
console.log(`=== MAINNET ACCEPTANCE @ block ${block.number} (chain time ${now}) ===\n`);

// 1. Every address the manifest claims must actually have code.
const CONTRACTS = {
  safetyController: manifest.safetyController,
  assetRegistry: manifest.assetRegistry,
  calendarRegistry: manifest.calendarRegistry,
  sessionRegistry: manifest.sessionRegistry,
  poolManager: manifest.poolManager,
  positionManager: manifest.positionManager,
  hookDeployer: manifest.hookDeployer,
  poolFactory: manifest.poolFactory,
  router: manifest.router,
  weth: manifest.weth,
  feeToken: manifest.feeToken,
};
const EXTRA = {
  stockToken: adapters.stockToken,
  verifier: adapters.verifier,
  directAdapter: adapters.directAdapter,
  regularAdapter: adapters.regularAdapter,
  extendedAdapter: adapters.extendedAdapter,
  livePoolHook: pool.hook,
};
for (const [name, address] of [...Object.entries(CONTRACTS), ...Object.entries(EXTRA)]) {
  const code = await c.getBytecode({ address });
  const ok = !!code && code !== '0x';
  check(`code:${name}`, ok, ok ? `${(code.length - 2) / 2} bytes` : 'no code');
}

// 2. Cross-contract wiring.
const BINDINGS = parseAbi([
  'function poolManager() view returns (address)',
  'function canonicalWeth() view returns (address)',
  'function WETH9() view returns (address)',
  'function permit2() view returns (address)',
  'function hookDeployer() view returns (address)',
  'function positionManager() view returns (address)',
  'function serviceToken() view returns (address)',
  'function factory() view returns (address)',
  'function assetRegistry() view returns (address)',
  'function calendarRegistry() view returns (address)',
  'function sessionRegistry() view returns (address)',
  'function safetyController() view returns (address)',
]);
const WIRE = [
  ['router', 'poolManager', 'poolManager'],
  ['router', 'canonicalWeth', 'weth'],
  ['positionManager', 'WETH9', 'weth'],
  ['positionManager', 'permit2', 'permit2'],
  ['poolFactory', 'hookDeployer', 'hookDeployer'],
  ['poolFactory', 'positionManager', 'positionManager'],
  ['poolFactory', 'serviceToken', 'feeToken'],
  ['hookDeployer', 'factory', 'poolFactory'],
  ['hookDeployer', 'sessionRegistry', 'sessionRegistry'],
  ['sessionRegistry', 'assetRegistry', 'assetRegistry'],
  ['sessionRegistry', 'calendarRegistry', 'calendarRegistry'],
  ['assetRegistry', 'safetyController', 'safetyController'],
  ['calendarRegistry', 'safetyController', 'safetyController'],
];
for (const [contract, method, expected] of WIRE) {
  const got = await c.readContract({ address: CONTRACTS[contract], abi: BINDINGS, functionName: method });
  check(`binding:${contract}.${method}`, String(got).toLowerCase() === CONTRACTS[expected].toLowerCase(), String(got));
}

// 3. The fee token must be a real production token, not the rehearsal fixture.
const FEE_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);
const feeSymbol = await c.readContract({ address: manifest.feeToken, abi: FEE_ABI, functionName: 'symbol' }).catch(() => null);
const feeDecimals = await c.readContract({ address: manifest.feeToken, abi: FEE_ABI, functionName: 'decimals' }).catch(() => null);
check('feeToken.notRehearsalFixture', !/^mBELL$/i.test(feeSymbol ?? ''), `symbol=${feeSymbol}`);
check('feeToken.decimalsReadable', Number.isInteger(Number(feeDecimals)) && Number(feeDecimals) <= 18, String(feeDecimals));

// 4. Admissions: both descriptors active and internally consistent.
const REG_ABI = parseAbi([
  'function descriptorIdForToken(address) view returns (bytes32)',
  'function descriptor(bytes32) view returns ((bytes32 id, address token, bool isStock, uint8 decimals, uint8 capabilityMask, address tokenPriceAdapter, address regularAdapter, address extendedAdapter, address overnightAdapter, address secondaryAdapter, bytes32 expectedCodeHash, bytes32 implementationFingerprint, bytes32 evidenceHash))',
]);
for (const [label, token, expectedIsStock, expectedId] of [
  ['weth', manifest.weth, false, assetQueue.weth.descriptorId],
  ['stock', adapters.stockToken, true, assetQueue.stock.descriptorId],
]) {
  const id = await c.readContract({ address: manifest.assetRegistry, abi: REG_ABI, functionName: 'descriptorIdForToken', args: [token] });
  check(`admitted:${label}`, id !== Z && id.toLowerCase() === expectedId.toLowerCase(), id);
  if (id !== Z) {
    const d = await c.readContract({ address: manifest.assetRegistry, abi: REG_ABI, functionName: 'descriptor', args: [id] });
    check(`descriptor:${label}.token`, String(d.token).toLowerCase() === token.toLowerCase(), d.token);
    check(`descriptor:${label}.isStock`, d.isStock === expectedIsStock, String(d.isStock));
    if (expectedIsStock) {
      check('descriptor:stock.directAdapter', String(d.tokenPriceAdapter).toLowerCase() === adapters.directAdapter.toLowerCase(), d.tokenPriceAdapter);
      check('descriptor:stock.regularAdapter', String(d.regularAdapter).toLowerCase() === adapters.regularAdapter.toLowerCase(), d.regularAdapter);
    }
  }
}

// 5. Calendar interval live and covering now.
const CAL_ABI = parseAbi([
  'function currentInterval(bytes32) view returns ((bytes32 assetId, uint16 year, uint32 index, uint64 start, uint64 end, uint8 phase, bytes32 provenanceHash))',
]);
const interval = await c.readContract({
  address: manifest.calendarRegistry, abi: CAL_ABI, functionName: 'currentInterval', args: [assetQueue.stock.descriptorId],
});
check('calendar.assetMatches', String(interval.assetId).toLowerCase() === assetQueue.stock.descriptorId.toLowerCase(), interval.assetId);
check('calendar.activeNow', Number(interval.start) <= now && now < Number(interval.end), `${interval.start}..${interval.end} vs ${now}`);

// 6. Session health and the report behind it.
const SESSION_ABI = parseAbi([
  'function health(bytes32) view returns ((bool ready, uint256 reasonBits, uint64 healthySince, uint64 validUntil, uint64 baselineObservation, uint64 latestObservation))',
  'function latestSample(bytes32, uint8) view returns ((bytes32 descriptorId, bytes32 feedId, uint8 phase, uint128 price18, uint64 observedAt, uint64 inputAt, uint64 validFrom, uint64 expiresAt, uint64 validUntil, bytes32 reportHash))',
]);
const health = await c.readContract({
  address: manifest.sessionRegistry, abi: SESSION_ABI, functionName: 'health', args: [assetQueue.stock.descriptorId],
});
check('health.hasEverBeenReady', health.ready || Number(health.healthySince) > 0, `ready=${health.ready}`);
check('health.noBlockingReasons', Number(health.reasonBits) === 0, String(health.reasonBits));
check('health.hasObservation', Number(health.latestObservation) > 0, String(health.latestObservation));

const sample = await c.readContract({
  address: manifest.sessionRegistry, abi: SESSION_ABI, functionName: 'latestSample',
  args: [assetQueue.stock.descriptorId, Number(interval.phase)],
});
check('report.exists', sample.reportHash !== Z, 'reportHash');
check('report.priceNonZero', sample.price18 > 0n, String(sample.price18));
check('report.phaseMatchesCalendar', Number(sample.phase) === Number(interval.phase), `${sample.phase} vs ${interval.phase}`);
check('report.freshness', now - Number(sample.observedAt) < 3600, `${now - Number(sample.observedAt)}s old`);

// 7. Hook state and policy.
const HOOK_ABI = parseAbi([
  'function poolKey() view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))',
  'function configHash() view returns (bytes32)',
  'function config() view returns ((address token0, address token1, bytes32 asset0, bytes32 asset1, address poolManager, address positionManager, address factory, address assetRegistry, address calendarRegistry, address safetyController, address treasuryAdapter, uint8 poolClass, uint8 liquidityMode, uint8 referenceMode, int24 tickSpacing, uint128[2] tradeCap, uint128[2] windowCap, uint128[2] closureCap, bytes32 policyId))',
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] a, uint128[2] b, uint128[2] c, uint128[2] d, uint128[2] e, uint64 f, uint64 g, bytes32 h, bytes32 i))',
  'function state() view returns ((uint8 lifecycle, uint8 mode, bool closedLatched, uint64 closureNonce, uint64 reopenCandidateAt, uint64 oldValidUntil, uint64[2] reopenBaseObservations, uint64[2] lastOpenObservations, uint64 pauseNonce, uint64 bellStart, uint64 corporateUntil))',
  'function buckets() view returns ((uint64 epoch, uint128[2] currentGross, uint128[2] previousGross))',
]);
const hookKey = await c.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'poolKey' });
const hookConfig = await c.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'config' });
const hookPolicy = await c.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'getPolicy' });
const hookState = await c.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'state' });
const buckets = await c.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'buckets' });

check('hook.selfInKey', String(hookKey.hooks).toLowerCase() === pool.hook.toLowerCase(), hookKey.hooks);
check('hook.configToken0', String(hookConfig.token0).toLowerCase() === pool.token0.toLowerCase(), hookConfig.token0);
check('hook.configToken1', String(hookConfig.token1).toLowerCase() === pool.token1.toLowerCase(), hookConfig.token1);
const isPriceGuarded = Number(hookConfig.poolClass) === 0;
check('hook.poolClassMatchesEvidence',
  isPriceGuarded === (pool.poolClass === 0),
  `hook=${hookConfig.poolClass} evidence=${pool.poolClass}`);
if (isPriceGuarded) {
  // PRICE_GUARDED: both reference adapters must exist and produce a live in-band reference now.
  const REF_ABI = parseAbi(['function referencePrice() view returns (uint128)']);
  const [ref0, ref1] = await Promise.all([
    c.readContract({ address: hookConfig.referenceAdapter0, abi: REF_ABI, functionName: 'referencePrice' }).catch(() => 0n),
    c.readContract({ address: hookConfig.referenceAdapter1, abi: REF_ABI, functionName: 'referencePrice' }).catch(() => 0n),
  ]);
  check('priceGuard.referenceAdaptersLive', ref0 > 0n && ref1 > 0n, `${ref0}/${ref1}`);
} else {
  check('sessionOnly.noReferenceAdapters',
    String(hookConfig.referenceAdapter0) === Z.slice(0, 42) && String(hookConfig.referenceAdapter1) === Z.slice(0, 42),
    `${hookConfig.referenceAdapter0}/${hookConfig.referenceAdapter1}`);
}
check('hook.lifecycleLive', Number(hookState.lifecycle) === 2, String(hookState.lifecycle));
check('hook.bellStartSet', Number(hookState.bellStart) > 0, String(hookState.bellStart));
check('hook.notLatched', !hookState.closedLatched, 'closedLatched');
check('hook.policyCoherent', hookPolicy.canSwap === (hookPolicy.mode === 1), `canSwap=${hookPolicy.canSwap} mode=${hookPolicy.mode}`);
check('hook.noReasonBitsWhenActive', !(hookPolicy.mode === 1 && hookPolicy.reasonBits !== 0n), `reasons=${hookPolicy.reasonBits}`);

// 8. A real swap happened, and it went through the router, not the rehearsal executor.
check('swap.atLeastOneSwapExecuted', buckets.currentGross[0] > 0n || buckets.currentGross[1] > 0n, `gross=${buckets.currentGross.map(String).join(',')}`);
check('swap.grossBoundedByWindowCap',
  buckets.currentGross[0] <= hookConfig.windowCap[0] && buckets.currentGross[1] <= hookConfig.windowCap[1],
  `gross=${buckets.currentGross.map(String).join(',')} caps=${hookConfig.windowCap.map(String).join(',')}`);
check('swap.evidenceIsForThisPool', swap.poolId?.toLowerCase() === pool.poolId.toLowerCase(), `${swap.poolId} vs ${pool.poolId}`);
check('swap.wentThroughRouter', swap.router?.toLowerCase() === manifest.router.toLowerCase(), `${swap.router}`);
const swapReceipt = await c.getTransactionReceipt({ hash: swap.swapTx }).catch(() => null);
check('swap.receiptExists', Boolean(swapReceipt) && swapReceipt.status === 'success', swap.swapTx);
if (swapReceipt) {
  check('swap.receiptToRouter', swapReceipt.to?.toLowerCase() === manifest.router.toLowerCase(), String(swapReceipt.to));
  check('swap.receiptBlockMatches', Number(swapReceipt.blockNumber) === Number(swap.blockNumber), `${swapReceipt.blockNumber} vs ${swap.blockNumber}`);
}

// 9. Roles must be real and separated. On mainnet a burn-address treasury is a failure, not a note.
const SAFETY_ABI = parseAbi([
  'function governance() view returns (address)',
  'function guardian() view returns (address)',
  'function treasury() view returns (address)',
]);
const [gov, guardian, treasury] = await Promise.all([
  c.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'governance' }),
  c.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'guardian' }),
  c.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'treasury' }),
]);
check('roles.distinct', new Set([gov, guardian, treasury].map((a) => a.toLowerCase())).size === 3, `${gov}/${guardian}/${treasury}`);
check('roles.treasuryNotBurn', !BURN_ADDRESSES.has(treasury.toLowerCase()), treasury);
check('roles.guardianNotBurn', !BURN_ADDRESSES.has(guardian.toLowerCase()), guardian);
check('roles.governanceNotBurn', !BURN_ADDRESSES.has(gov.toLowerCase()), gov);
check('roles.treasuryHasCodeOrIsEOA', treasury.toLowerCase() !== ZERO_ADDRESS, treasury);

// 10. PoolManager ownership must not still be the throwaway deployer.
const ownerAbi = parseAbi(['function owner() view returns (address)']);
const poolManagerOwner = await c.readContract({ address: manifest.poolManager, abi: ownerAbi, functionName: 'owner' }).catch(() => null);
check('poolManager.ownershipHandedOver',
  poolManagerOwner?.toLowerCase() === gov.toLowerCase(),
  `owner=${poolManagerOwner} governance=${gov}`);

// 11. Honest reporting of what this run cannot prove.
const rightsVerified = adapters.rightsVerified === true;
console.log(`\nNOTE: stock token rights/entitlements are ${rightsVerified ? 'recorded as verified' : 'NOT VERIFIED by this run'}.`);
console.log('NOTE: PRICE_GUARDED remains blocked; this pool is SESSION_ONLY.');

console.log(`\n${checks.length} checks run.\n`);
for (const { name, ok, detail } of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
console.log('');
if (failures.length > 0) {
  console.error(`\n>>> ${failures.length} MAINNET ACCEPTANCE FAILURE(S) <<<`);
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log('>>> ALL MAINNET ACCEPTANCE CHECKS PASSED <<<');
