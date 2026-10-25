import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAggregatorPrice, normalizeUnderlyingWithMultiplier } from '../src/price-source.mjs';

test('normalizes adjusted token and quote feeds to 1e18 without rescaling token-adjusted values', () => {
  const adjusted = normalizeAggregatorPrice({ answer: 200000000n, feedDecimals: 8, updatedAt: 1000, now: 1001, heartbeatSeconds: 86400, policyMaximumAgeSeconds: 600, priceBasis: 'TOKEN_ADJUSTED' });
  assert.equal(adjusted.price18, 2n * 10n ** 18n);
  assert.equal(adjusted.priceBasis, 'TOKEN_ADJUSTED');
});

test('applies a live multiplier once only to an underlying price', () => {
  assert.equal(normalizeUnderlyingWithMultiplier(10n * 10n ** 18n, 2n * 10n ** 18n), 20n * 10n ** 18n);
  assert.equal(normalizeUnderlyingWithMultiplier(20n * 10n ** 18n, 2n * 10n ** 18n, 'TOKEN_ADJUSTED'), 20n * 10n ** 18n);
});

test('uses the stricter policy/heartbeat maximum age and rejects invalid proxy rounds', () => {
  const stale = normalizeAggregatorPrice({ answer: 100000000n, feedDecimals: 8, updatedAt: 100, now: 701, heartbeatSeconds: 86400, policyMaximumAgeSeconds: 600, priceBasis: 'QUOTE_USD' });
  assert.equal(stale.reason, 'PRICE_STALE');
  const expiryBoundary = normalizeAggregatorPrice({ answer: 100000000n, feedDecimals: 8, updatedAt: 100, now: 700, heartbeatSeconds: 86400, policyMaximumAgeSeconds: 600, priceBasis: 'QUOTE_USD' });
  assert.equal(expiryBoundary.reason, 'PRICE_STALE');
  assert.equal(normalizeAggregatorPrice({ answer: -1n, feedDecimals: 8, updatedAt: 1000, now: 1001, heartbeatSeconds: 0, policyMaximumAgeSeconds: 600, priceBasis: 'QUOTE_USD' }).reason, 'INVALID_ANSWER');
  assert.equal(normalizeAggregatorPrice({ answer: 1n, feedDecimals: 19, updatedAt: 1000, now: 1001, heartbeatSeconds: 0, policyMaximumAgeSeconds: 600, priceBasis: 'QUOTE_USD' }).reason, 'INVALID_DECIMALS');
  assert.equal(normalizeAggregatorPrice({ answer: 1n, feedDecimals: 8, updatedAt: 1002, now: 1001, heartbeatSeconds: 0, policyMaximumAgeSeconds: 600, priceBasis: 'QUOTE_USD' }).reason, 'INVALID_TIMESTAMP');
});
