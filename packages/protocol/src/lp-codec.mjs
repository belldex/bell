import { encodeAbiParameters, encodeFunctionData } from 'viem';

export const POSITION_MANAGER_LP_ABI = Object.freeze([{
  type: 'function', name: 'modifyLiquidities', stateMutability: 'payable',
  inputs: [{ name: 'unlockData', type: 'bytes' }, { name: 'deadline', type: 'uint256' }], outputs: [],
}]);
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

function address(value, name, minimum = 1n) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || BigInt(value) < minimum) throw new TypeError(`${name} must be an explicit nonzero address`);
  return value.toLowerCase();
}
function uint(value, name, max = UINT256_MAX, min = 0n) {
  if (typeof value !== 'bigint' && !(typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value))) throw new TypeError(`${name} must be bigint or canonical decimal string`);
  const n = BigInt(value);
  if (n < min || n > max) throw new RangeError(`${name} outside ABI bounds`);
  return n;
}
function pair(values, name) {
  if (!Array.isArray(values) || values.length !== 2) throw new TypeError(`${name} needs two amounts`);
  return values.map(x => uint(x, name, UINT128_MAX));
}

/** Offline direct-PM calldata only. Caller supplies the reviewed pinned deployment and position currencies.
 * PM authenticates the signed account against its NFT and derives the canonical position/ticks/salt.
 * No oracle/backend/keeper read, project custody, alternate payer, swap, wrap or from-deltas action.
 */
export function buildPublicLpTransaction(request) {
  const { operation } = request;
  if (!['increase', 'remove', 'collect'].includes(operation)) throw new TypeError('unsupported PUBLIC LP operation');
  const account = address(request.account, 'account', 3n);
  const to = address(request.positionManager, 'positionManager', 3n);
  const recipient = address(request.recipient, 'recipient', 3n);
  if (recipient === to) throw new TypeError('recipient cannot be PositionManager');
  if (request.payer !== undefined && address(request.payer, 'payer') !== account) throw new TypeError('payer must be authenticated account');
  if (request.hookData !== undefined && request.hookData !== '0x') throw new TypeError('hookData must be empty');
  const currency0 = address(request.currency0, 'currency0');
  const currency1 = address(request.currency1, 'currency1');
  if (currency0 >= currency1) throw new RangeError('currencies must be sorted and distinct ERC20s');
  const tokenId = uint(request.tokenId, 'tokenId', UINT256_MAX, 1n);
  const now = uint(request.now, 'now');
  const deadline = uint(request.deadline, 'deadline');
  if (deadline < now || deadline > now + 120n) throw new RangeError('deadline must be current and within 120 seconds');
  const liquidity = uint(request.liquidity ?? (operation === 'collect' ? '0' : undefined), 'liquidity', UINT128_MAX, operation === 'collect' ? 0n : 1n);
  if (operation === 'collect' && liquidity !== 0n) throw new RangeError('collect must use zero liquidity');
  const [a0, a1] = pair(operation === 'increase' ? request.amountMax : request.amountMin ?? (operation === 'collect' ? ['0', '0'] : undefined), 'amount bounds');
  // Pinned PM slippage checks exclude fees. Nonzero fee minima would be an untrue guarantee.
  if (operation === 'collect' && (a0 !== 0n || a1 !== 0n)) throw new RangeError('pinned PM does not enforce fee-collection minima');
  // A remove is the only exit the pinned PM gates with amountMin. Zero on either leg accepts any
  // price, so refuse to encode an unprotected exit instead of silently sending one.
  if (operation === 'remove' && (a0 === 0n || a1 === 0n)) {
    throw new RangeError('a remove requires a nonzero minimum for both legs; zero accepts any price');
  }
  const params = [encodeAbiParameters([
    { type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' },
  ], [tokenId, liquidity, a0, a1, '0x'])];
  const increase = operation === 'increase';
  params.push(encodeAbiParameters(increase
    ? [{ type: 'address' }, { type: 'address' }]
    : [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
  increase ? [currency0, currency1] : [currency0, currency1, recipient]));
  // Pinned v4-periphery Actions: INCREASE=0, DECREASE=1, SETTLE_PAIR=13, TAKE_PAIR=17.
  const unlockData = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [increase ? '0x000d' : '0x0111', params]);
  return { account, to, value: 0n, data: encodeFunctionData({ abi: POSITION_MANAGER_LP_ABI, functionName: 'modifyLiquidities', args: [unlockData, deadline] }) };
}
