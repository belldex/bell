import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderPolicyConstants } from './generate-policy-constants.mjs';

test('generates deterministic Solidity policy constants from the validated machine source', async () => {
  const policy = JSON.parse(await readFile(new URL('../../config/policy/policy-v1.json', import.meta.url), 'utf8'));
  const output = renderPolicyConstants(policy);
  assert.match(output, /FEE_REGULAR\s*=\s*500/);
  assert.match(output, /MAX_REPORT_AGE_SECONDS\s*=\s*120/);
  assert.match(output, /ACTIVE_BAND_BPS\s*=\s*200/);
  assert.equal(renderPolicyConstants(policy), output);
});

test('refuses runtime-relaxed or structurally invalid policy constants', async () => {
  const policy = JSON.parse(await readFile(new URL('../../config/policy/policy-v1.json', import.meta.url), 'utf8'));
  policy.freshness.reportAgeSeconds = 86400;
  assert.throws(() => renderPolicyConstants(policy), /freshness/i);
});
