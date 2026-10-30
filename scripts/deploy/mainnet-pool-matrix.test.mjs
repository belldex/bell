import test from 'node:test';
import assert from 'node:assert/strict';

const matrixModule = await import('./mainnet-pool-matrix-lib.mjs').catch(() => null);

test('plans every stock/counter pair and one canonical PRICE_GUARDED pair per stock pair', () => {
  assert.equal(typeof matrixModule?.buildPoolMatrixPlan, 'function');
  const plan = matrixModule.buildPoolMatrixPlan({
    stocks: ['AAPL', 'NVDA', 'TSLA'],
    counters: [
      ['WETH', { symbol: 'WETH', isStock: false }],
      ['USDG', { symbol: 'USDG', isStock: false }],
    ],
    classList: [0, 1],
    references: Object.fromEntries(['AAPL', 'NVDA', 'TSLA', 'WETH', 'USDG'].map((symbol) => [`${symbol}/USD`, { adapter: `0x${'11'.repeat(20)}` }])),
    seeds: Object.fromEntries([
      'AAPL/WETH', 'AAPL/USDG', 'NVDA/WETH', 'NVDA/USDG', 'TSLA/WETH', 'TSLA/USDG',
      'AAPL/NVDA', 'AAPL/TSLA', 'NVDA/TSLA',
    ].map((pair) => [pair, { amountStock: '1', amountCounter: '2' }])),
  });

  assert.equal(plan.candidates.length, 15);
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.candidates.filter((item) => item.poolClass === 1).length, 6);
  assert.equal(plan.candidates.filter((item) => item.counterIsStock).length, 3);
  assert.deepEqual(plan.candidates.filter((item) => item.counterIsStock).map((item) => `${item.stock}/${item.counter}`), [
    'AAPL/NVDA', 'AAPL/TSLA', 'NVDA/TSLA',
  ]);
});

test('skips PRICE_GUARDED candidates when explicit seed amounts are absent', () => {
  assert.equal(typeof matrixModule?.buildPoolMatrixPlan, 'function');
  const plan = matrixModule.buildPoolMatrixPlan({
    stocks: ['AAPL'],
    counters: [['WETH', { symbol: 'WETH', isStock: false }]],
    classList: [0],
    references: { 'AAPL/USD': { adapter: `0x${'11'.repeat(20)}` }, 'WETH/USD': { adapter: `0x${'22'.repeat(20)}` } },
  });
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /explicit seed amounts/);
});

test('skips PRICE_GUARDED candidates when either reference adapter is missing', () => {
  assert.equal(typeof matrixModule?.buildPoolMatrixPlan, 'function');
  const plan = matrixModule.buildPoolMatrixPlan({
    stocks: ['AAPL'],
    counters: [['WETH', { symbol: 'WETH', isStock: false }]],
    classList: [0],
    references: { 'AAPL/USD': { adapter: `0x${'11'.repeat(20)}` } },
    seeds: { 'AAPL/WETH': { amountStock: '1', amountCounter: '2' } },
  });
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /reference adapter/);
});
