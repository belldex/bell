import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReferencePolicy } from '../src/reference-policy.mjs';

const unit = 10n ** 18n;

test('PRICE_GUARDED active mode applies multiplier once and cross-checks the adjusted token feed', () => {
  const result = buildReferencePolicy({
    poolClass: 'PRICE_GUARDED', now: 1000,
    stock: { mode: 'ACTIVE', underlyingPrice18: 10n * unit, multiplier18: 2n * unit, directAdjustedTokenPrice18: 20n * unit },
    quote: { price18: 5n * unit, updatedAt: 990 },
  });
  assert.equal(result.canPriceGuard, true);
  assert.deepEqual(result.reference, { numerator: 20n * unit, denominator: 5n * unit });
  assert.equal(result.mode, 'ACTIVE');
});

test('weekend mode freezes stock close but uses a fresh live quote, not a frozen pair ratio', () => {
  const result = buildReferencePolicy({
    poolClass: 'PRICE_GUARDED', now: 2000,
    stock: { mode: 'CLOSED', multiplier18: 2n * unit, anchor: { price18: 20n * unit, inputAt: 1000, multiplier18: 2n * unit } },
    quote: { price18: 4n * unit, updatedAt: 1990 },
  });
  assert.equal(result.mode, 'FROZEN_CLOSE');
  assert.deepEqual(result.reference, { numerator: 20n * unit, denominator: 4n * unit });
});

test('rejects active cross-source deviation, expired anchors, multiplier changes, and stale quotes', () => {
  const active = { mode: 'ACTIVE', underlyingPrice18: 10n * unit, multiplier18: unit, directAdjustedTokenPrice18: 102n * unit / 100n };
  assert.equal(buildReferencePolicy({ poolClass: 'PRICE_GUARDED', now: 100, stock: active, quote: { price18: unit, updatedAt: 100 } }).reason, 'CROSS_SOURCE_DEVIATION');
  const stock = { mode: 'CLOSED', multiplier18: unit, anchor: { price18: unit, inputAt: 1, multiplier18: unit } };
  assert.equal(buildReferencePolicy({ poolClass: 'PRICE_GUARDED', now: 345602, stock, quote: { price18: unit, updatedAt: 345600 } }).reason, 'ANCHOR_EXPIRED');
  assert.equal(buildReferencePolicy({ poolClass: 'PRICE_GUARDED', now: 2000, stock: { ...stock, multiplier18: 2n * unit }, quote: { price18: unit, updatedAt: 1999 } }).reason, 'CORPORATE_MISMATCH');
  assert.equal(buildReferencePolicy({ poolClass: 'PRICE_GUARDED', now: 2000, stock, quote: { price18: unit, updatedAt: 1000 } }).reason, 'QUOTE_STALE');
});

test('SESSION_ONLY makes no counterasset reference or price-protection claim', () => {
  const result = buildReferencePolicy({ poolClass: 'SESSION_ONLY', now: 1000, stock: { mode: 'CLOSED' }, quote: null });
  assert.equal(result.canPriceGuard, false);
  assert.equal(result.reference, null);
  assert.equal(result.mode, 'SESSION_ONLY');
});
