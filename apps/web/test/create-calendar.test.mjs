import test from 'node:test';
import assert from 'node:assert/strict';
import { createPricePathForPhases } from '../lib/create-calendar.mjs';

test('pool creation uses a verified anchor path when every stock leg is market-free', () => {
  assert.equal(createPricePathForPhases([5]), 'anchor');
  assert.equal(createPricePathForPhases([5, 5]), 'anchor');
});

test('pool creation refreshes signed prices only when every stock leg has an active supported source', () => {
  assert.equal(createPricePathForPhases([2]), 'signed-quote');
  assert.equal(createPricePathForPhases([1, 3]), 'signed-quote');
});

test('pool creation fails closed for mixed and unsupported price phases', () => {
  assert.equal(createPricePathForPhases([]), 'unavailable');
  assert.equal(createPricePathForPhases([5, 2]), 'unavailable');
  assert.equal(createPricePathForPhases([4]), 'unavailable');
  assert.equal(createPricePathForPhases([0]), 'unavailable');
});
