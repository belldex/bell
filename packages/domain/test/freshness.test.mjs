import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateActiveSample } from '../src/freshness.mjs';

const sample = (overrides = {}) => ({
  phase: 'REGULAR',
  price18: 1000000n,
  observedAt: 1000,
  inputAt: 990,
  validFrom: 900,
  expiresAt: 1200,
  ...overrides,
});

test('requires report, phase boundary, and input timestamp freshness simultaneously', () => {
  assert.deepEqual(evaluateActiveSample(sample(), 1040, 1300), { healthy: true, reason: null, validUntil: 1120 });
  assert.equal(evaluateActiveSample(sample(), 1120, 1300).reason, 'REPORT_EXPIRED');
  assert.equal(evaluateActiveSample(sample({ inputAt: 939 }), 1000, 1300).reason, 'INPUT_STALE');
});

test('caps validUntil at the current phase boundary and treats equality as expired', () => {
  const boundarySample = sample({ observedAt: 1090, inputAt: 1090 });
  assert.equal(evaluateActiveSample(boundarySample, 1099, 1100).healthy, true);
  assert.equal(evaluateActiveSample(boundarySample, 1100, 1100).reason, 'REPORT_EXPIRED');
});

test('allows nonmonotonic provider input time when the current sample remains within its phase age bound', () => {
  const result = evaluateActiveSample(sample({ observedAt: 1050, inputAt: 1040 }), 1060, 1300);
  assert.equal(result.healthy, true);
});

test('rejects invalid price, future timestamps, unknown phase, and invalid time bounds', () => {
  assert.equal(evaluateActiveSample(sample({ price18: 0n }), 1010, 1300).reason, 'INVALID_PRICE');
  assert.equal(evaluateActiveSample(sample({ inputAt: 1020 }), 1010, 1300).reason, 'INVALID_TIMESTAMP');
  assert.equal(evaluateActiveSample(sample({ phase: 'UNKNOWN' }), 1010, 1300).reason, 'UNSUPPORTED_PHASE');
  assert.throws(() => evaluateActiveSample(sample(), -1, 1300), /now/i);
});
