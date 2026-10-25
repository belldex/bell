import test from 'node:test';
import assert from 'node:assert/strict';
import { maximumClosureCap } from '../src/seed-budget.mjs';

test('caps each closure budget by two trades, rolling window, and one tenth of actual seed', () => {
  assert.deepEqual(maximumClosureCap([100n, 900n], [500n, 1000n], [999n, 2000n]), [99n, 200n]);
});

test('floors seed fraction without rounding up and rejects a zero resulting cap', () => {
  assert.deepEqual(maximumClosureCap([10n, 10n], [100n, 100n], [19n, 9n]), [1n, 0n]);
});

test('rejects invalid seed and fixed cap domains', () => {
  assert.throws(() => maximumClosureCap([0n, 1n], [1n, 1n], [10n, 10n]));
  assert.throws(() => maximumClosureCap([1n, 1n], [1n], [10n, 10n]));
  assert.throws(() => maximumClosureCap([1n, 1n], [1n, 1n], [-1n, 1n]));
});
