import test from 'node:test';
import assert from 'node:assert/strict';
import { createPricePathForPhases } from '../lib/create-calendar.mjs';

test('pool creation uses a verified anchor path when every stock leg is market-free', () => {
  assert.equal(createPricePathForPhases([5]), 'anchor');
  assert.equal(createPricePathForPhases([5, 5]), 'anchor');
});

test('pool creation uses the onchain Chainlink feed for every active market session', () => {
  for (const phase of [1, 2, 3, 4]) assert.equal(createPricePathForPhases([phase]), 'chainlink-feed');
  assert.equal(createPricePathForPhases([1, 3, 4]), 'chainlink-feed');
});

test('pool creation fails closed for mixed and unsupported price phases', () => {
  assert.equal(createPricePathForPhases([]), 'unavailable');
  assert.equal(createPricePathForPhases([5, 2]), 'unavailable');
  assert.equal(createPricePathForPhases([0]), 'unavailable');
});
