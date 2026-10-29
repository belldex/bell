/**
 * Build a mainnet `BellRouter.SwapRequest`.
 *
 * The testnet rehearsal swaps through `TestnetSwapExecutor`, a fixture that calls PoolManager
 * directly. That is fine for proving hook callbacks fire, but it is not the code a real user
 * touches. On mainnet the swap must go through `BellRouter`, which adds nonces, a deadline,
 * slippage bounds, and canonical WETH wrapping/unwrapping — so the request shape and the
 * wrap/unwrap decisions are built here, where they can be tested without an RPC.
 */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

// Uniswap v4 TickMath bounds.
const MIN_SQRT_PRICE_LIMIT = 4295128740n;
const MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341n;

function address(value, name) {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new TypeError(`${name} must be an EVM address`);
  return value;
}

function nonZeroAddress(value, name) {
  const parsed = address(value, name);
  if (parsed.toLowerCase() === ZERO_ADDRESS) throw new RangeError(`${name} must not be the zero address`);
  return parsed;
}

/** Which token is being sold and which is being bought for a given direction. */
export function resolveSwapLegs({ token0, token1, zeroForOne }) {
  const a = address(token0, 'token0');
  const b = address(token1, 'token1');
  return zeroForOne ? { tokenIn: a, tokenOut: b } : { tokenIn: b, tokenOut: a };
}

export function buildMainnetSwapRequest(input) {
  const {
    hook, zeroForOne, amountIn, recipient, nonce, deadline, expectedConfigHash,
    token0, token1, weth, now, useNativeInput = false, unwrapOutput = false,
  } = input;

  const hookAddress = nonZeroAddress(hook, 'hook');
  const recipientAddress = nonZeroAddress(recipient, 'recipient');
  if (typeof amountIn !== 'bigint' || amountIn <= 0n) throw new RangeError('amountIn must be a positive bigint');
  if (typeof nonce !== 'bigint' || nonce < 0n) throw new RangeError('nonce must be a non-negative bigint');
  if (typeof deadline !== 'bigint' || deadline <= 0n) throw new RangeError('deadline must be a positive bigint');
  if (now !== undefined && deadline <= now) throw new RangeError('deadline has already passed');
  if (typeof expectedConfigHash !== 'string' || !BYTES32.test(expectedConfigHash)) {
    throw new TypeError('expectedConfigHash must be a bytes32 hash');
  }

  const legs = resolveSwapLegs({ token0, token1, zeroForOne });
  const wethAddress = address(weth, 'weth');

  // BellRouter rejects limitAmount == 0 with SettlementMismatch, which reads like a settlement
  // bug rather than "you forgot slippage protection". Require it explicitly.
  const limitAmount = input.limitAmount;
  if (typeof limitAmount !== 'bigint' || limitAmount <= 0n) {
    throw new RangeError('limitAmount is the router slippage bound and must be a positive bigint');
  }

  // Wrapping only makes sense when the input really is WETH; otherwise the router would demand
  // msg.value for a token the caller is not paying in native ETH.
  if (useNativeInput && legs.tokenIn.toLowerCase() !== wethAddress.toLowerCase()) {
    throw new Error('native input requires the input token to be WETH');
  }
  if (unwrapOutput && legs.tokenOut.toLowerCase() !== wethAddress.toLowerCase()) {
    throw new Error('unwrap output requires the output token to be WETH');
  }

  return Object.freeze({
    hook: hookAddress,
    zeroForOne: Boolean(zeroForOne),
    exactInput: true,
    amountSpecified: amountIn,
    limitAmount,
    sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT,
    recipient: recipientAddress,
    nonce,
    deadline,
    expectedConfigHash,
    wrapInput: useNativeInput,
    unwrapOutput,
    unwrapRefund: useNativeInput,
  });
}
