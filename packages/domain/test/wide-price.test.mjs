import test from 'node:test';
import assert from 'node:assert/strict';
import { allowsPricePath, isWithinPriceBand } from '../src/wide-price.mjs';

const Q96 = 1n << 96n;
const USD = 10n ** 18n;

test('compares a unit AMM price against equal normalized references', () => {
  assert.equal(isWithinPriceBand(Q96, USD, USD, 18, 18, 200), true);
});

test('rejects prices outside the band in both currency orders', () => {
  assert.equal(isWithinPriceBand(Q96 * 9n / 10n, USD, USD, 18, 18, 200), false);
  assert.equal(isWithinPriceBand(Q96 * 11n / 10n, USD, USD, 18, 18, 200), false);
  assert.equal(isWithinPriceBand(Q96, 2n * USD, USD, 18, 18, 200), false);
  assert.equal(isWithinPriceBand(Q96, USD, 2n * USD, 18, 18, 200), false);
});

test('allows only directional repricing toward the reference without overshoot', () => {
  const below = Q96 * 9n / 10n;
  const inside = Q96;
  const above = Q96 * 11n / 10n;
  assert.equal(allowsPricePath(below, inside, USD, USD, 18, 18, 200), true);
  assert.equal(allowsPricePath(below, below - 1n, USD, USD, 18, 18, 200), false);
  assert.equal(allowsPricePath(above, inside, USD, USD, 18, 18, 200), true);
  assert.equal(allowsPricePath(above, above + 1n, USD, USD, 18, 18, 200), false);
  assert.equal(allowsPricePath(below, below, USD, USD, 18, 18, 200), false);
});

test('rejects invalid domains instead of wrapping intermediate products', () => {
  assert.throws(() => isWithinPriceBand(0n, USD, USD, 18, 18, 200));
  assert.throws(() => isWithinPriceBand(Q96, USD, USD, 19, 18, 200));
  assert.throws(() => isWithinPriceBand(Q96, USD, USD, 18, 18, 100));
});
