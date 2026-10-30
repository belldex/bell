/**
 * Pure pool-configuration helpers for mainnet pool creation.
 *
 * The testnet script builds the token/asset ordering inline and hardcodes
 * `policyId: keccak256('bell-testnet-v1')`. On mainnet both matter: an ordering slip swaps the
 * quote leg into the wrong slot, and a testnet policy id would label a production pool as a
 * rehearsal. Keeping the derivation here makes it testable without an RPC.
 */
import { encodeAbiParameters, keccak256, stringToHex } from 'viem';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
function requireAddress(value, name) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || value.toLowerCase() === ZERO_ADDRESS) {
    throw new TypeError(`${name} must be a nonzero EVM address`);
  }
  return value.toLowerCase();
}

function requireAssetId(value, name) {
  if (typeof value !== 'string' || !BYTES32.test(value) || /^0x0{64}$/i.test(value)) {
    throw new TypeError(`${name} must be a nonzero bytes32 asset id`);
  }
  return value.toLowerCase();
}

function requirePositive(value, name) {
  if (typeof value !== 'bigint' || value <= 0n) throw new RangeError(`${name} must be a positive bigint`);
  return value;
}

/**
 * Reference adapters are optional and default to the zero address (no reference on that side).
 * A configured value must be a well-formed EVM address, lowercased for canonical hashing.
 */
function resolveReferenceAdapter(value, name) {
  if (value === undefined || value === null) return ZERO_ADDRESS;
  if (typeof value !== 'string' || !ADDRESS.test(value)) {
    throw new TypeError(`${name} must be an EVM address when provided`);
  }
  return value.toLowerCase();
}

/** Canonicalize any admitted token pair; each asset ID and price adapter follows its token. */
export function sortPoolTokens({
  tokenA, assetA, tokenB, assetB,
  referenceAdapterA,
  referenceAdapterB,
}) {
  const addressA = requireAddress(tokenA, 'tokenA');
  const addressB = requireAddress(tokenB, 'tokenB');
  const idA = requireAssetId(assetA, 'assetA');
  const idB = requireAssetId(assetB, 'assetB');
  if (addressA === addressB) throw new Error('pool tokens must be distinct');

  const refA = resolveReferenceAdapter(referenceAdapterA, 'referenceAdapterA');
  const refB = resolveReferenceAdapter(referenceAdapterB, 'referenceAdapterB');

  return addressA < addressB
    ? { token0: addressA, asset0: idA, referenceAdapter0: refA, token1: addressB, asset1: idB, referenceAdapter1: refB }
    : { token0: addressB, asset0: idB, referenceAdapter0: refB, token1: addressA, asset1: idA, referenceAdapter1: refA };
}

/** Build the factory config, the Uniswap key, and the seed amounts for a mainnet pool. */
export function resolvePoolConfig(input) {
  const {
    tokenA, assetA, tokenB, assetB,
    amountAMax, amountBMax,
    poolManager, positionManager, factory, assetRegistry, calendarRegistry, safetyController,
    policyId = 'bell-mainnet-v1',
    tickSpacing = 60,
    tradeCap = [10n, 10n],
    windowCap = [100n, 100n],
    closureCap = [1n, 1n],
    poolClass = 1, // SESSION_ONLY by default; 0 = PRICE_GUARDED (requires both reference adapters)
  } = input;

  const sorted = sortPoolTokens({
    tokenA, assetA, tokenB, assetB,
    referenceAdapterA: input.referenceAdapterA,
    referenceAdapterB: input.referenceAdapterB,
  });
  if (poolClass === 0 && (sorted.referenceAdapter0 === ZERO_ADDRESS || sorted.referenceAdapter1 === ZERO_ADDRESS)) {
    throw new Error('PRICE_GUARDED requires a nonzero reference adapter for both pool tokens');
  }
  if (poolClass === 1 && (sorted.referenceAdapter0 !== ZERO_ADDRESS || sorted.referenceAdapter1 !== ZERO_ADDRESS)) {
    throw new Error('SESSION_ONLY must not configure price reference adapters');
  }
  const amountA = requirePositive(amountAMax, 'amountAMax');
  const amountB = requirePositive(amountBMax, 'amountBMax');

  const tokenAIsToken0 = sorted.token0 === requireAddress(tokenA, 'tokenA');
  const amountMax = tokenAIsToken0 ? [amountA, amountB] : [amountB, amountA];

  if (![0, 1].includes(poolClass)) throw new RangeError('poolClass must be 0 (PRICE_GUARDED) or 1 (SESSION_ONLY)');

  // PoolConfig.policyId is a bytes32, and the deploy script stores keccak256(bytes(label)). Passing
  // the raw label would either throw at encode time or produce a hash the factory never committed.
  const policyIdHash = keccak256(stringToHex(policyId));

  const config = {
    token0: sorted.token0,
    token1: sorted.token1,
    asset0: sorted.asset0,
    asset1: sorted.asset1,
    poolManager: requireAddress(poolManager, 'poolManager'),
    positionManager: requireAddress(positionManager, 'positionManager'),
    factory: requireAddress(factory, 'factory'),
    assetRegistry: requireAddress(assetRegistry, 'assetRegistry'),
    calendarRegistry: requireAddress(calendarRegistry, 'calendarRegistry'),
    safetyController: requireAddress(safetyController, 'safetyController'),
    treasuryAdapter: ZERO_ADDRESS,
    poolClass,
    liquidityMode: 0, // PUBLIC
    referenceMode: 0,
    tickSpacing,
    tradeCap,
    windowCap,
    closureCap,
    policyId: policyIdHash,
    // Chainlink reference adapters per pool side (token0/token1 order). Zero means "no reference
    // on this side"; the factory rejects any non-zero adapter on SESSION_ONLY pools, and
    // PRICE_GUARDED requires both to be set with an in-band initial price.
    referenceAdapter0: sorted.referenceAdapter0,
    referenceAdapter1: sorted.referenceAdapter1,
  };

  return Object.freeze({
    ...sorted,
    policyId,
    policyIdHash,
    poolClass,
    config,
    key: {
      currency0: sorted.token0,
      currency1: sorted.token1,
      fee: 0x800000,
      tickSpacing,
      hooks: ZERO_ADDRESS,
    },
    amountMax,
  });
}

/**
 * Derive the initial pool sqrtPriceX96 from two 1e18-scale reference prices so the opening price
 * sits inside the PRICE_GUARDED band. sqrtPriceX96 = sqrt(priceRatio) * 2^96, where priceRatio is
 * token1-per-token0 on the raw axis (accounting for each token's decimals).
 */
export function deriveInitialSqrtPrice({ price0_18, price1_18, decimals0 = 18, decimals1 = 18 }) {
  for (const [name, value, decimals] of [['price0_18', price0_18, 18], ['price1_18', price1_18, 18]]) {
    if (typeof value !== 'bigint' || value <= 0n) throw new RangeError(`${name} must be a positive bigint at 1e18 scale`);
    void decimals;
  }
  if (!Number.isSafeInteger(decimals0) || decimals0 < 0 || decimals0 > 18) throw new RangeError('decimals0 out of range');
  if (!Number.isSafeInteger(decimals1) || decimals1 < 0 || decimals1 > 18) throw new RangeError('decimals1 out of range');
  // PoolManager sqrtPriceX96 encodes raw token1 per raw token0:
  // (P0 / 10^d0) / (P1 / 10^d1) = (P0 * 10^d1) / (P1 * 10^d0).
  // The 1e18 price scales cancel in the ratio.
  const num = price0_18 * 10n ** BigInt(decimals1);
  const den = price1_18 * 10n ** BigInt(decimals0);
  // sqrtPriceX96 = floor(sqrt(num/den) * 2^96) computed with extra precision to avoid truncation:
  // sqrtPriceX96 = floor(sqrt(num * 2^192 / den))
  const scaled = num << 192n;
  let lo = 0n;
  let hi = (1n << 160n);
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid * mid <= scaled / den) lo = mid; else hi = mid - 1n;
  }
  return lo;
}

/**
 * Reproduce `BellPoolFactory._profileHash`.
 *
 * The factory zeroes token0/token1/asset0/asset1 and hashes the rest, so policyId, tickSpacing and
 * the caps all survive. Comparing this against the deployed `profileHash()` is the only cheap way
 * to catch a request that would revert with InvalidConfiguration.
 */
export function deriveProfileHash(config) {
  const zeroed = {
    ...config,
    token0: ZERO_ADDRESS,
    token1: ZERO_ADDRESS,
    asset0: `0x${'0'.repeat(64)}`,
    asset1: `0x${'0'.repeat(64)}`,
    // Pool class and reference adapters are per-pool risk choices. A single immutable factory
    // profile must be able to create both SESSION_ONLY and PRICE_GUARDED pools with pair-specific
    // feed adapters; the hook config hash still pins them per created pool.
    poolClass: 0,
    referenceAdapter0: ZERO_ADDRESS,
    referenceAdapter1: ZERO_ADDRESS,
  };
  return keccak256(encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' },
        { name: 'asset0', type: 'bytes32' }, { name: 'asset1', type: 'bytes32' },
        { name: 'poolManager', type: 'address' }, { name: 'positionManager', type: 'address' },
        { name: 'factory', type: 'address' }, { name: 'assetRegistry', type: 'address' },
        { name: 'calendarRegistry', type: 'address' }, { name: 'safetyController', type: 'address' },
        { name: 'treasuryAdapter', type: 'address' }, { name: 'poolClass', type: 'uint8' },
        { name: 'liquidityMode', type: 'uint8' }, { name: 'referenceMode', type: 'uint8' },
        { name: 'tickSpacing', type: 'int24' }, { name: 'tradeCap', type: 'uint128[2]' },
        { name: 'windowCap', type: 'uint128[2]' }, { name: 'closureCap', type: 'uint128[2]' },
        { name: 'policyId', type: 'bytes32' },
        // Appended after policyId, matching the Solidity PoolConfig field order exactly.
        { name: 'referenceAdapter0', type: 'address' }, { name: 'referenceAdapter1', type: 'address' },
      ],
    }],
    [zeroed],
  ));
}

/** Check seed/fee funding, allowing native ETH to supply a missing WETH balance. */
export function checkSeedFunding({
  token0,
  weth,
  amountMax,
  tokenA,
  tokenB,
  tokenABalance,
  tokenBBalance,
  wethBalance,
  stockBalance,
  nativeBalance,
  nativeGasReserve = 0n,
  feeBalance,
  feeToken,
  serviceFee,
  wrapNativeForWeth = false,
} = {}) {
  if (!Array.isArray(amountMax) || amountMax.length !== 2 || amountMax.some((x) => typeof x !== 'bigint' || x < 0n)) {
    throw new TypeError('amountMax must be a two-element non-negative bigint array');
  }
  const generic = tokenA !== undefined || tokenB !== undefined;
  const effectiveBalances = generic
    ? { tokenABalance, tokenBBalance }
    : { wethBalance, stockBalance };
  for (const [name, value] of Object.entries({ ...effectiveBalances, nativeBalance, nativeGasReserve, feeBalance, serviceFee })) {
    if (typeof value !== 'bigint' || value < 0n) throw new TypeError(`${name} must be a non-negative bigint`);
  }
  const indexOf = (token) => token0?.toLowerCase() === token?.toLowerCase() ? 0 : 1;
  const wethIsPairToken = generic && (tokenA?.toLowerCase() === weth?.toLowerCase() || tokenB?.toLowerCase() === weth?.toLowerCase());
  const requiredWeth = weth && (!generic || wethIsPairToken) ? amountMax[indexOf(weth)] : 0n;
  const wethFunds = generic
    ? (tokenA?.toLowerCase() === weth?.toLowerCase() ? tokenABalance : tokenB?.toLowerCase() === weth?.toLowerCase() ? tokenBBalance : 0n)
    : wethBalance;
  const wethShortfall = !generic || wethIsPairToken
    ? (requiredWeth > wethFunds ? requiredWeth - wethFunds : 0n)
    : 0n;
  const nativeToWrap = wrapNativeForWeth ? wethShortfall : 0n;
  const nativeAfterWrap = nativeBalance > nativeToWrap ? nativeBalance - nativeToWrap : 0n;
  const shortfalls = [];
  if (wethShortfall > 0n && (!wrapNativeForWeth || nativeBalance < wethShortfall)) {
    shortfalls.push(wrapNativeForWeth
      ? `native ETH ${nativeBalance} < WETH shortfall ${wethShortfall}`
      : `WETH ${wethBalance} < ${requiredWeth}`);
  }
  if (wrapNativeForWeth && nativeBalance >= nativeToWrap && nativeAfterWrap < nativeGasReserve) {
    shortfalls.push(`native ETH after wrap ${nativeAfterWrap} < gas reserve ${nativeGasReserve}`);
  }
  if (generic) {
    const requiredA = amountMax[indexOf(tokenA)];
    const requiredB = amountMax[indexOf(tokenB)];
    if (tokenABalance < requiredA && (!wethIsPairToken || tokenA?.toLowerCase() !== weth?.toLowerCase())
      && tokenA?.toLowerCase() !== feeToken?.toLowerCase()) {
      shortfalls.push(`token ${tokenA} balance ${tokenABalance} < ${requiredA}`);
    }
    if (tokenBBalance < requiredB && (!wethIsPairToken || tokenB?.toLowerCase() !== weth?.toLowerCase())
      && tokenB?.toLowerCase() !== feeToken?.toLowerCase()) {
      shortfalls.push(`token ${tokenB} balance ${tokenBBalance} < ${requiredB}`);
    }
  } else {
    const stockIndex = 1 - indexOf(weth);
    const requiredStock = amountMax[stockIndex];
    if (stockBalance < requiredStock) shortfalls.push(`stock ${stockBalance} < ${requiredStock}`);
  }
  const feeSeed = generic && feeToken
    ? (tokenA?.toLowerCase() === feeToken.toLowerCase() ? amountMax[indexOf(tokenA)]
      : tokenB?.toLowerCase() === feeToken.toLowerCase() ? amountMax[indexOf(tokenB)] : 0n)
    : 0n;
  if (feeSeed > 0n) {
    const feeTokenLegBalance = tokenA?.toLowerCase() === feeToken.toLowerCase() ? tokenABalance : tokenBBalance;
    if (feeTokenLegBalance < feeSeed) shortfalls.push(`fee token seed balance ${feeTokenLegBalance} < ${feeSeed}`);
  }
  if (feeBalance < serviceFee + feeSeed) {
    shortfalls.push(feeSeed > 0n
      ? `fee token ${feeBalance} < service fee ${serviceFee} + seed ${feeSeed}`
      : `fee token ${feeBalance} < ${serviceFee}`);
  }
  return Object.freeze({ shortfalls: Object.freeze(shortfalls), nativeToWrap, nativeAfterWrap });
}
