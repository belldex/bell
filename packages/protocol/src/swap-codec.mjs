import { decodeAbiParameters, encodeAbiParameters } from 'viem';

const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;
export const SWAP_REQUEST_COMPONENTS = Object.freeze([
  { name: 'hook', type: 'address' },
  { name: 'zeroForOne', type: 'bool' },
  { name: 'exactInput', type: 'bool' },
  { name: 'amountSpecified', type: 'uint128' },
  { name: 'limitAmount', type: 'uint128' },
  { name: 'sqrtPriceLimitX96', type: 'uint160' },
  { name: 'recipient', type: 'address' },
  { name: 'nonce', type: 'uint64' },
  { name: 'deadline', type: 'uint64' },
  { name: 'expectedConfigHash', type: 'bytes32' },
  { name: 'wrapInput', type: 'bool' },
  { name: 'unwrapOutput', type: 'bool' },
  { name: 'unwrapRefund', type: 'bool' },
]);
const ABI = [{ type: 'tuple', components: SWAP_REQUEST_COMPONENTS }];

function uint(value, maximum, label, { positive = false } = {}) {
  let parsed;
  if (typeof value === 'bigint') parsed = value;
  else if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) parsed = BigInt(value);
  else throw new TypeError(`${label} must be a bigint or canonical decimal string`);
  if (parsed < (positive ? 1n : 0n) || parsed > maximum) throw new RangeError(`${label} is outside its unsigned ABI width`);
  return parsed;
}

function normalizeSwapRequest(request) {
  if (!request || typeof request !== 'object') throw new TypeError('SwapRequest must be an object');
  if (!ADDRESS.test(request.hook ?? '') || !ADDRESS.test(request.recipient ?? '')) throw new TypeError('SwapRequest address is invalid');
  if (!BYTES32.test(request.expectedConfigHash ?? '') || request.expectedConfigHash.toLowerCase() === `0x${'0'.repeat(64)}`) {
    throw new TypeError('expectedConfigHash must be a nonzero bytes32');
  }
  for (const field of ['zeroForOne', 'exactInput', 'wrapInput', 'unwrapOutput', 'unwrapRefund']) {
    if (typeof request[field] !== 'boolean') throw new TypeError(`${field} must be boolean`);
  }
  if (request.unwrapRefund && !request.wrapInput) throw new Error('unwrapRefund requires wrapInput');
  return {
    hook: request.hook.toLowerCase(),
    zeroForOne: request.zeroForOne,
    exactInput: request.exactInput,
    amountSpecified: uint(request.amountSpecified, UINT128_MAX, 'amountSpecified', { positive: true }),
    limitAmount: uint(request.limitAmount, UINT128_MAX, 'limitAmount', { positive: true }),
    sqrtPriceLimitX96: uint(request.sqrtPriceLimitX96, UINT160_MAX, 'sqrtPriceLimitX96', { positive: true }),
    recipient: request.recipient.toLowerCase(),
    nonce: uint(request.nonce, UINT64_MAX, 'nonce'),
    deadline: uint(request.deadline, UINT64_MAX, 'deadline', { positive: true }),
    expectedConfigHash: request.expectedConfigHash.toLowerCase(),
    wrapInput: request.wrapInput,
    unwrapOutput: request.unwrapOutput,
    unwrapRefund: request.unwrapRefund,
  };
}

export function encodeSwapRequest(request) {
  return encodeAbiParameters(ABI, [normalizeSwapRequest(request)]);
}

function normalizeDecoded(wire) {
  const values = Array.isArray(wire) ? wire : SWAP_REQUEST_COMPONENTS.map(({ name }) => wire[name]);
  return {
    hook: values[0].toLowerCase(),
    zeroForOne: values[1],
    exactInput: values[2],
    amountSpecified: values[3].toString(),
    limitAmount: values[4].toString(),
    sqrtPriceLimitX96: values[5].toString(),
    recipient: values[6].toLowerCase(),
    nonce: values[7].toString(),
    deadline: values[8].toString(),
    expectedConfigHash: values[9].toLowerCase(),
    wrapInput: values[10],
    unwrapOutput: values[11],
    unwrapRefund: values[12],
  };
}

export function decodeSwapRequest(encoded) {
  if (typeof encoded !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(encoded)) throw new TypeError('SwapRequest calldata must be even-length hex bytes');
  let decoded;
  try {
    decoded = normalizeDecoded(decodeAbiParameters(ABI, encoded)[0]);
  } catch {
    throw new Error('SwapRequest ABI decoding failed');
  }
  if (encodeSwapRequest(decoded).toLowerCase() !== encoded.toLowerCase()) throw new Error('SwapRequest calldata is non-canonical or has trailing bytes');
  return decoded;
}
