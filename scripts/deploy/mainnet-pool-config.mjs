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
  } = input;

  const sorted = sortPoolTokens({ weth, wethAssetId, stock, stockAssetId });
  const wethAmount = requirePositive(wethMax, 'wethMax');
  const stockAmount = requirePositive(stockMax, 'stockMax');

  const wethIsToken0 = sorted.token0 === requireAddress(weth, 'weth');
  const amountMax = wethIsToken0 ? [wethAmount, stockAmount] : [stockAmount, wethAmount];

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
    poolClass: 1, // SESSION_ONLY; PRICE_GUARDED stays blocked until a reference is admitted
    liquidityMode: 0, // PUBLIC
    referenceMode: 0,
    tickSpacing,
    tradeCap,
    windowCap,
    closureCap,
    policyId: policyIdHash,
  };

  return Object.freeze({
    ...sorted,
    policyId,
    policyIdHash,
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
