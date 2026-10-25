import { decodeAbiParameters, encodeAbiParameters } from 'viem';

const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const INT24_MIN = -(1n << 23n);
const INT24_MAX = (1n << 23n) - 1n;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;
const ZERO32 = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

export const POOL_CONFIG_COMPONENTS = Object.freeze([
  { name: 'token0', type: 'address' },
  { name: 'token1', type: 'address' },
  { name: 'asset0', type: 'bytes32' },
  { name: 'asset1', type: 'bytes32' },
  { name: 'poolManager', type: 'address' },
  { name: 'positionManager', type: 'address' },
  { name: 'factory', type: 'address' },
  { name: 'assetRegistry', type: 'address' },
  { name: 'calendarRegistry', type: 'address' },
  { name: 'safetyController', type: 'address' },
  { name: 'treasuryAdapter', type: 'address' },
  { name: 'poolClass', type: 'uint8' },
  { name: 'liquidityMode', type: 'uint8' },
  { name: 'referenceMode', type: 'uint8' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'tradeCap', type: 'uint128[2]' },
  { name: 'windowCap', type: 'uint128[2]' },
  { name: 'closureCap', type: 'uint128[2]' },
  { name: 'policyId', type: 'bytes32' },
]);

export const CREATE_REQUEST_COMPONENTS = Object.freeze([
  { name: 'config', type: 'tuple', components: POOL_CONFIG_COMPONENTS },
  { name: 'salt', type: 'bytes32' },
  { name: 'nonce', type: 'uint64' },
  { name: 'deadline', type: 'uint64' },
  { name: 'recipient', type: 'address' },
  { name: 'sqrtPriceX96', type: 'uint160' },
  { name: 'tickLower', type: 'int24' },
  { name: 'tickUpper', type: 'int24' },
  { name: 'liquidity', type: 'uint128' },
  { name: 'amountMax', type: 'uint128[2]' },
  { name: 'maxServiceFee', type: 'uint128' },
]);

const ABI = [{ type: 'tuple', components: CREATE_REQUEST_COMPONENTS }];

function uint(value, maximum, name, { positive = false } = {}) {
  let parsed;
  if (typeof value === 'bigint') parsed = value;
  else if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) parsed = BigInt(value);
  else throw new TypeError(`${name} must be a bigint or canonical decimal string`);
  if (parsed < (positive ? 1n : 0n) || parsed > maximum) throw new RangeError(`${name} is outside its unsigned ABI width`);
  return parsed;
}

function int24(value, name) {
  let parsed;
  if (typeof value === 'bigint') parsed = value;
  else if (typeof value === 'string' && /^-?(?:0|[1-9][0-9]*)$/.test(value)) parsed = BigInt(value);
  else if (typeof value === 'number' && Number.isSafeInteger(value)) parsed = BigInt(value);
  else throw new TypeError(`${name} must be a bigint or canonical decimal string`);
  if (parsed < INT24_MIN || parsed > INT24_MAX) throw new RangeError(`${name} is outside int24`);
  return parsed;
}

function uintPair(values, label, { positive = true } = {}) {
  if (!Array.isArray(values) || values.length !== 2) throw new RangeError(`${label} must contain exactly two currencies`);
  return values.map((value) => uint(value, UINT128_MAX, `${label}[]`, { positive }));
}

function normalizePoolConfig(config) {
  if (!config || typeof config !== 'object') throw new TypeError('PoolConfig must be an object');
  const addresses = ['token0', 'token1', 'poolManager', 'positionManager', 'factory', 'assetRegistry', 'calendarRegistry', 'safetyController'];
  for (const field of addresses) {
    if (!ADDRESS.test(config[field] ?? '') || config[field].toLowerCase() === ZERO_ADDRESS) throw new TypeError(`PoolConfig.${field} is invalid`);
  }
  if (config.treasuryAdapter !== undefined && (!ADDRESS.test(config.treasuryAdapter) || (Number(config.liquidityMode) === 1 && config.treasuryAdapter.toLowerCase() === ZERO_ADDRESS))) {
    throw new TypeError('PoolConfig.treasuryAdapter is invalid for its liquidity mode');
  }
  const token0 = config.token0.toLowerCase();
  const token1 = config.token1.toLowerCase();
  if (token0 >= token1) throw new RangeError('PoolConfig token addresses must be sorted token0 < token1');
  for (const field of ['asset0', 'asset1', 'policyId']) {
    if (!BYTES32.test(config[field] ?? '') || config[field].toLowerCase() === ZERO32) throw new TypeError(`PoolConfig.${field} must be a nonzero bytes32`);
  }
  for (const field of ['poolClass', 'liquidityMode', 'referenceMode']) {
    if (!Number.isInteger(config[field]) || config[field] < 0 || config[field] > 255) throw new RangeError(`PoolConfig.${field} must fit uint8`);
  }
  if (config.poolClass > 1 || config.liquidityMode > 1) throw new RangeError('PoolConfig class/mode is unsupported');
  const tickSpacing = int24(config.tickSpacing, 'tickSpacing');
  if (tickSpacing !== 60n) throw new RangeError('PoolConfig tickSpacing must be 60');
  const tradeCap = uintPair(config.tradeCap, 'tradeCap');
  const windowCap = uintPair(config.windowCap, 'windowCap');
  const closureCap = uintPair(config.closureCap, 'closureCap');
  for (let i = 0; i < 2; i += 1) {
    if (tradeCap[i] > windowCap[i] || closureCap[i] > 2n * tradeCap[i] || closureCap[i] > windowCap[i]) {
      throw new RangeError('PoolConfig caps violate T <= W and C <= min(2T, W)');
    }
  }
  return {
    token0,
    token1,
    asset0: config.asset0.toLowerCase(),
    asset1: config.asset1.toLowerCase(),
    poolManager: config.poolManager.toLowerCase(),
    positionManager: config.positionManager.toLowerCase(),
    factory: config.factory.toLowerCase(),
    assetRegistry: config.assetRegistry.toLowerCase(),
    calendarRegistry: config.calendarRegistry.toLowerCase(),
    safetyController: config.safetyController.toLowerCase(),
    treasuryAdapter: (config.treasuryAdapter ?? ZERO_ADDRESS).toLowerCase(),
    poolClass: config.poolClass,
    liquidityMode: config.liquidityMode,
    referenceMode: config.referenceMode,
    tickSpacing: Number(tickSpacing),
    tradeCap,
    windowCap,
    closureCap,
    policyId: config.policyId.toLowerCase(),
  };
}

function normalizeCreateRequest(request) {
  if (!request || typeof request !== 'object') throw new TypeError('CreateRequest must be an object');
  if (!ADDRESS.test(request.recipient ?? '') || request.recipient.toLowerCase() === ZERO_ADDRESS) throw new TypeError('recipient is invalid');
  if (!BYTES32.test(request.salt ?? '') || request.salt.toLowerCase() === ZERO32) throw new TypeError('salt must be a nonzero bytes32');
  const lower = int24(request.tickLower, 'tickLower');
  const upper = int24(request.tickUpper, 'tickUpper');
  if (lower >= upper) throw new RangeError('tickLower must be less than tickUpper');
  return {
    config: normalizePoolConfig(request.config),
    salt: request.salt.toLowerCase(),
    nonce: uint(request.nonce, UINT64_MAX, 'nonce'),
    deadline: uint(request.deadline, UINT64_MAX, 'deadline', { positive: true }),
    recipient: request.recipient.toLowerCase(),
    sqrtPriceX96: uint(request.sqrtPriceX96, UINT160_MAX, 'sqrtPriceX96', { positive: true }),
    tickLower: lower,
    tickUpper: upper,
    liquidity: uint(request.liquidity, UINT128_MAX, 'liquidity', { positive: true }),
    amountMax: uintPair(request.amountMax, 'amountMax'),
    maxServiceFee: uint(request.maxServiceFee, UINT128_MAX, 'maxServiceFee'),
  };
}

export function encodeCreateRequest(request) {
  return encodeAbiParameters(ABI, [normalizeCreateRequest(request)]);
}

function normalizeDecoded(request) {
  const v = Array.isArray(request) ? request : CREATE_REQUEST_COMPONENTS.map(({ name }) => request[name]);
  const c = Array.isArray(v[0]) ? v[0] : POOL_CONFIG_COMPONENTS.map(({ name }) => v[0][name]);
  const config = {
    token0: c[0].toLowerCase(), token1: c[1].toLowerCase(), asset0: c[2].toLowerCase(), asset1: c[3].toLowerCase(),
    poolManager: c[4].toLowerCase(), positionManager: c[5].toLowerCase(), factory: c[6].toLowerCase(),
    assetRegistry: c[7].toLowerCase(), calendarRegistry: c[8].toLowerCase(), safetyController: c[9].toLowerCase(),
    treasuryAdapter: c[10].toLowerCase(),
    poolClass: Number(c[11]), liquidityMode: Number(c[12]), referenceMode: Number(c[13]), tickSpacing: Number(c[14]),
    tradeCap: c[15].map(String), windowCap: c[16].map(String), closureCap: c[17].map(String), policyId: c[18],
  };
  return {
    config,
    salt: v[1],
    nonce: v[2].toString(),
    deadline: v[3].toString(),
    recipient: v[4].toLowerCase(),
    sqrtPriceX96: v[5].toString(),
    tickLower: Number(v[6]),
    tickUpper: Number(v[7]),
    liquidity: v[8].toString(),
    amountMax: v[9].map(String),
    maxServiceFee: v[10].toString(),
  };
}

export function decodeCreateRequest(encoded) {
  if (typeof encoded !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(encoded)) throw new TypeError('CreateRequest calldata must be even-length hex bytes');
  let request;
  try {
    request = normalizeDecoded(decodeAbiParameters(ABI, encoded)[0]);
  } catch {
    throw new Error('CreateRequest ABI decoding failed');
  }
  if (encodeCreateRequest(request).toLowerCase() !== encoded.toLowerCase()) throw new Error('CreateRequest calldata is non-canonical or has trailing bytes');
  return request;
}
