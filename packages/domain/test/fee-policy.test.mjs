import test from 'node:test';
import assert from 'node:assert/strict';
import { bellFee, effectiveLpFee } from '../src/fee-policy.mjs';

test('bell fee uses the rounded-up 300-second decay', () => {
  assert.equal(bellFee(500, 0), 10000);
  assert.equal(bellFee(500, 150), 5250);
  assert.equal(bellFee(500, 300), 500);
  assert.equal(bellFee(5000, 150), 7500);
});

test('effective LP fee is the maximum session, bell, corporate, and repricing fee', () => {
  assert.equal(effectiveLpFee({ baseSessionFee: 3000, bellElapsed: 300, corporate: false, repricing: false }), 3000);
  assert.equal(effectiveLpFee({ baseSessionFee: 500, bellElapsed: 300, corporate: true, repricing: false }), 10000);
  assert.equal(effectiveLpFee({ baseSessionFee: 5000, bellElapsed: 300, corporate: false, repricing: true }), 10000);
});

test('rejects unsupported fee units and invalid bell elapsed time', () => {
  assert.throws(() => bellFee(501, 1));
  assert.throws(() => bellFee(500, -1));
  assert.throws(() => effectiveLpFee({ baseSessionFee: 42, bellElapsed: 10 }));
});
