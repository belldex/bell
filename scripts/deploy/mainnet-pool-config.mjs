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

/**
 * Order a WETH/stock pair canonically, keeping every assetId attached to its own token.
 * `asset0` follows `token0`; it is never assigned by position in the input.
 */
export function sortPoolTokens({ weth, wethAssetId, stock, stockAssetId }) {
  const wethAddress = requireAddress(weth, 'weth');
  const stockAddress = requireAddress(stock, 'stock');
  const wethId = requireAssetId(wethAssetId, 'wethAssetId');
  const stockId = requireAssetId(stockAssetId, 'stockAssetId');
  if (wethAddress === stockAddress) throw new Error('pool tokens must be distinct');

  return wethAddress < stockAddress
    ? { token0: wethAddress, asset0: wethId, token1: stockAddress, asset1: stockId }
    : { token0: stockAddress, asset0: stockId, token1: wethAddress, asset1: wethId };
}

/** Build the factory config, the Uniswap key, and the seed amounts for a mainnet pool. */
export function resolvePoolConfig(input) {
  const {
    weth, wethAssetId, stock, stockAssetId,
    wethMax, stockMax,
    poolManager, positionManager, factory, assetRegistry, calendarRegistry, safetyController,
    policyId = 'bell-mainnet-v1',
    tickSpacing = 60,
    tradeCap = [10n, 10n],
    windowCap = [100n, 100n],
    closureCap = [1n, 1n],
    poolClass = 1, // SESSION_ONLY by default; 0 = PRICE_GUARDED (requires both reference adapters)
  } = input;

  const sorted = sortPoolTokens({ weth, wethAssetId, stock, stockAssetId });
  const wethAmount = requirePositive(wethMax, 'wethMax');
  const stockAmount = requirePositive(stockMax, 'stockMax');

  const wethIsToken0 = sorted.token0 === requireAddress(weth, 'weth');
  const amountMax = wethIsToken0 ? [wethAmount, stockAmount] : [stockAmount, wethAmount];

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
    referenceAdapter0: resolveReferenceAdapter(input.referenceAdapter0, 'referenceAdapter0'),
    referenceAdapter1: resolveReferenceAdapter(input.referenceAdapter1, 'referenceAdapter1'),
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
  // rawRatio = (price0/1e18 * 10^-d0 inverted appropriately) ... normalized:
  // raw token1 per raw token0 = (price0_18 / price1_18) * 10^(d0 - d1)
  const num = price0_18 * 10n ** BigInt(decimals0);
  const den = price1_18 * 10n ** BigInt(decimals1);
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
  wethBalance,
  stockBalance,
  nativeBalance,
  nativeGasReserve = 0n,
  feeBalance,
  serviceFee,
  wrapNativeForWeth = false,
} = {}) {
  if (!Array.isArray(amountMax) || amountMax.length !== 2 || amountMax.some((x) => typeof x !== 'bigint' || x < 0n)) {
    throw new TypeError('amountMax must be a two-element non-negative bigint array');
  }
  for (const [name, value] of Object.entries({ wethBalance, stockBalance, nativeBalance, nativeGasReserve, feeBalance, serviceFee })) {
    if (typeof value !== 'bigint' || value < 0n) throw new TypeError(`${name} must be a non-negative bigint`);
  }
  const wethIndex = token0?.toLowerCase() === weth?.toLowerCase() ? 0 : 1;
  const stockIndex = 1 - wethIndex;
  const requiredWeth = amountMax[wethIndex];
  const requiredStock = amountMax[stockIndex];
  const wethShortfall = requiredWeth > wethBalance ? requiredWeth - wethBalance : 0n;
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
  if (stockBalance < requiredStock) shortfalls.push(`stock ${stockBalance} < ${requiredStock}`);
  if (feeBalance < serviceFee) shortfalls.push(`fee token ${feeBalance} < ${serviceFee}`);
  return Object.freeze({ shortfalls: Object.freeze(shortfalls), nativeToWrap, nativeAfterWrap });
}
