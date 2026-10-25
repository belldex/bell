import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePolicyConfig } from '../src/policy-config.mjs';

test('validates the locked BELL policy constants from the reviewed machine-readable source', async () => {
  const policy = JSON.parse(await readFile(new URL('../../../config/policy/policy-v1.json', import.meta.url), 'utf8'));
  assert.equal(validatePolicyConfig(policy), true);
  assert.deepEqual(policy.fees.session, { REGULAR: 500, PRE: 3000, POST: 3000, OVERNIGHT: 5000, CLOSED: 10000 });
  assert.deepEqual(policy.sessions.phase, { UNKNOWN: 0, PRE: 1, REGULAR: 2, POST: 3, OVERNIGHT: 4, CLOSED: 5 });
});

test('rejects relaxed freshness, missing session classes, and unbounded source payloads', async () => {
  const policy = JSON.parse(await readFile(new URL('../../../config/policy/policy-v1.json', import.meta.url), 'utf8'));
  assert.throws(() => validatePolicyConfig({ ...policy, freshness: { reportAgeSeconds: 86400 } }), /freshness/i);
  assert.throws(() => validatePolicyConfig({ ...policy, fees: { session: { REGULAR: 500 } } }), /fee|session/i);
  assert.throws(() => validatePolicyConfig({ ...policy, bounds: { ...policy.bounds, maxReports: 1000000 } }), /bound|report/i);
});
