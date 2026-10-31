import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSwapBounds } from '../lib/swap-quote.mjs';

test('exact-input preserves input and rounds the minimum output down', () => {
  assert.deepEqual(calculateSwapBounds({ exactInput: true, amountIn: 1000n, amountOut: 901n, slippageBps: 50 }), {
    maxIn: 1000n, minOut: 896n,
  });
});

test('exact-output preserves requested output and rounds maximum input up', () => {
  assert.deepEqual(calculateSwapBounds({ exactInput: false, amountIn: 1000n, amountOut: 901n, slippageBps: 50 }), {
    maxIn: 1006n, minOut: 901n,
  });
});

test('swap bounds reject invalid slippage and zero amounts', () => {
  assert.throws(() => calculateSwapBounds({ exactInput: true, amountIn: 0n, amountOut: 1n, slippageBps: 50 }), /positive/);
  assert.throws(() => calculateSwapBounds({ exactInput: true, amountIn: 1n, amountOut: 1n, slippageBps: 10_000 }), /slippage/);
});
