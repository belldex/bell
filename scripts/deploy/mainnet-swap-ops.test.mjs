import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMainnetSwapPreflight, validateSwapBroadcastAuthorization } from './mainnet-swap-ops.mjs';

const base = {
  poolLive: true,
  canSwap: true,
  reasonBits: 0n,
  inputBalance: 100n,
  amount: 10n,
  remainingGross: 50n,
  rollingRemaining: 20n,
  minAmountOut: 5n,
  nativeBalance: 100n,
  useNativeInput: false,
};

test('valid swap satisfies health, balance, slippage and gross-budget gates', () => {
  assert.equal(validateMainnetSwapPreflight(base), true);
});

test('rejects halted policy, stale reasons, insufficient balances and excessive budgets', () => {
  assert.throws(() => validateMainnetSwapPreflight({ ...base, canSwap: false }), /halted/);
  assert.throws(() => validateMainnetSwapPreflight({ ...base, reasonBits: 1n }), /blocking reasons/);
  assert.throws(() => validateMainnetSwapPreflight({ ...base, inputBalance: 9n }), /insufficient input/);
  assert.throws(() => validateMainnetSwapPreflight({ ...base, amount: 21n }), /budget/);
  assert.throws(() => validateMainnetSwapPreflight({ ...base, minAmountOut: 0n }), /minAmountOut/);
});

test('native WETH input checks native balance without requiring ERC20 balance', () => {
  assert.equal(validateMainnetSwapPreflight({ ...base, inputBalance: 0n, nativeBalance: 10n, useNativeInput: true }), true);
  assert.throws(() => validateMainnetSwapPreflight({ ...base, inputBalance: 0n, nativeBalance: 9n, useNativeInput: true }), /native ETH/);
});

test('swap broadcast requires explicit operator authorization', () => {
  assert.equal(validateSwapBroadcastAuthorization({ broadcast: false }), false);
  assert.throws(() => validateSwapBroadcastAuthorization({ broadcast: true, authorized: false, pairLabel: 'USDG/AAPL', amount: 1n, minAmountOut: 1n }), /authorize-spend/);
  assert.equal(validateSwapBroadcastAuthorization({ broadcast: true, authorized: true, pairLabel: 'USDG/AAPL', amount: 1n, minAmountOut: 1n }), true);
});

test('a stale or recovering pool directs the operator to persist preparation before retrying a swap', () => {
  assert.throws(() => validateMainnetSwapPreflight({ ...base, canSwap: false, reasonBits: 256n }), /mainnet-prepare-oracles.*60 seconds.*new quote/i);
  assert.throws(() => validateMainnetSwapPreflight({ ...base, policyMode: 3 }), /mainnet-prepare-oracles/i);
});
