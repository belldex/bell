import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMainnetSwapRequest, resolveSwapLegs } from './mainnet-swap-request.mjs';

const WETH = '0x00000000000000000000000000000000000000aa';
const STOCK = '0x00000000000000000000000000000000000000bb';
const RECIPIENT = '0x00000000000000000000000000000000000000cc';
const HOOK = '0x00000000000000000000000000000000000000dd';
const CONFIG_HASH = `0x${'ab'.repeat(32)}`;

test('zeroForOne maps to token0 in and token1 out', () => {
  const legs = resolveSwapLegs({ token0: WETH, token1: STOCK, zeroForOne: true });
  assert.equal(legs.tokenIn, WETH);
  assert.equal(legs.tokenOut, STOCK);
});

test('oneForZero maps to token1 in and token0 out', () => {
  const legs = resolveSwapLegs({ token0: WETH, token1: STOCK, zeroForOne: false });
  assert.equal(legs.tokenIn, STOCK);
  assert.equal(legs.tokenOut, WETH);
});

test('selling the stock never asks the router to wrap native ETH', () => {
  // Stock is token1 here, so zeroForOne=false sells stock. wrapInput must be false or the router
  // would expect msg.value that the caller is not sending.
  const request = buildMainnetSwapRequest({
    hook: HOOK, zeroForOne: false, amountIn: 10n ** 18n, recipient: RECIPIENT,
    nonce: 0n, deadline: 1_800_000_000n, expectedConfigHash: CONFIG_HASH,
    token0: WETH, token1: STOCK, weth: WETH, minAmountOut: 10n ** 18n,
  });
  assert.equal(request.wrapInput, false);
  assert.equal(request.unwrapOutput, false);
});

test('buying the stock with native ETH wraps the input', () => {
  const request = buildMainnetSwapRequest({
    hook: HOOK, zeroForOne: true, amountIn: 10n ** 15n, recipient: RECIPIENT,
    nonce: 0n, deadline: 1_800_000_000n, expectedConfigHash: CONFIG_HASH,
    token0: WETH, token1: STOCK, weth: WETH, useNativeInput: true, minAmountOut: 10n ** 18n,
  });
  assert.equal(request.wrapInput, true);
});

test('native input is refused when the input token is not WETH', () => {
  assert.throws(
    () => buildMainnetSwapRequest({
      hook: HOOK, zeroForOne: false, amountIn: 1n, recipient: RECIPIENT,
      nonce: 0n, deadline: 1_800_000_000n, expectedConfigHash: CONFIG_HASH,
      token0: WETH, token1: STOCK, weth: WETH, useNativeInput: true, minAmountOut: 10n ** 18n,
    }),
    /native input/i,
  );
});

test('unwrapping output is refused when the output token is not WETH', () => {
  assert.throws(
    () => buildMainnetSwapRequest({
      hook: HOOK, zeroForOne: true, amountIn: 1n, recipient: RECIPIENT,
      nonce: 0n, deadline: 1_800_000_000n, expectedConfigHash: CONFIG_HASH,
      token0: WETH, token1: STOCK, weth: WETH, unwrapOutput: true, minAmountOut: 10n ** 18n,
    }),
    /unwrap/i,
  );
});

test('a zero amount, zero recipient, or expired deadline is rejected before the router sees it', () => {
  const base = {
    hook: HOOK, zeroForOne: true, amountIn: 1n, recipient: RECIPIENT,
    nonce: 0n, deadline: 1_800_000_000n, expectedConfigHash: CONFIG_HASH,
    token0: WETH, token1: STOCK, weth: WETH, minAmountOut: 10n ** 18n,
  };
  assert.throws(() => buildMainnetSwapRequest({ ...base, amountIn: 0n }), /amountIn/);
  assert.throws(() => buildMainnetSwapRequest({ ...base, recipient: '0x0000000000000000000000000000000000000000' }), /recipient/);
  assert.throws(() => buildMainnetSwapRequest({ ...base, deadline: 1_700_000_000n, now: 1_700_000_001n }), /deadline/);
});

test('the request pins the hook config hash so a redeployed hook cannot silently accept it', () => {
  const request = buildMainnetSwapRequest({
    hook: HOOK, zeroForOne: true, amountIn: 1n, recipient: RECIPIENT,
    nonce: 0n, deadline: 1_800_000_000n, expectedConfigHash: CONFIG_HASH,
    token0: WETH, token1: STOCK, weth: WETH, minAmountOut: 10n ** 18n,
  });
  assert.equal(request.expectedConfigHash, CONFIG_HASH);
  assert.equal(request.hook, HOOK);
  assert.equal(request.exactInput, true);
});

test('the price limit points the right way for each direction', () => {
  const base = {
    hook: HOOK, amountIn: 1n, recipient: RECIPIENT, nonce: 0n,
    deadline: 1_800_000_000n, expectedConfigHash: CONFIG_HASH,
    token0: WETH, token1: STOCK, weth: WETH, minAmountOut: 10n ** 18n,
  };
  const zeroForOne = buildMainnetSwapRequest({ ...base, zeroForOne: true });
  const oneForZero = buildMainnetSwapRequest({ ...base, zeroForOne: false });
  assert.equal(zeroForOne.sqrtPriceLimitX96, 4295128740n);
  assert.ok(oneForZero.sqrtPriceLimitX96 > zeroForOne.sqrtPriceLimitX96);
});

test('a missing minimum-output bound fails here, not as an opaque SettlementMismatch on the router', () => {
  assert.throws(
    () => buildMainnetSwapRequest({
      hook: HOOK, zeroForOne: true, amountIn: 1n, recipient: RECIPIENT,
      nonce: 0n, deadline: 1_800_000_000n, expectedConfigHash: CONFIG_HASH,
      token0: WETH, token1: STOCK, weth: WETH,
    }),
    /minAmountOut/,
  );
});

test('minimum output must be supplied explicitly in output-token units', () => {
  assert.throws(
    () => buildMainnetSwapRequest({
      hook: HOOK, zeroForOne: true, amountIn: 1n, recipient: RECIPIENT,
      nonce: 0n, deadline: 1_800_000_000n, expectedConfigHash: CONFIG_HASH,
      token0: WETH, token1: STOCK, weth: WETH,
    }),
    /minAmountOut/,
  );
  const request = buildMainnetSwapRequest({
    hook: HOOK, zeroForOne: true, amountIn: 1_000_000_000_000_000n, minAmountOut: 10n ** 18n,
    recipient: RECIPIENT, nonce: 0n, deadline: 1_800_000_000n, expectedConfigHash: CONFIG_HASH,
    token0: WETH, token1: STOCK, weth: WETH,
  });
  assert.equal(request.limitAmount, 10n ** 18n);
});
