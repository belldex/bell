import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseline } from './validate-baseline.mjs';

const validBaseline = {
  briefSha256: '2e7dbe11c4c01cd6d32415c8246a8a29878c92ee0c3500b7f888e7ba4e11fa0c',
  implementationPlanSha256: 'b'.repeat(64),
  scope: { milestones: 16, tasks: 80, gaps: 40, decisions: 12, releaseGates: 6 },
  gates: Object.fromEntries(['E01', 'E02', 'E03', 'E04', 'E05', 'E06'].map((id) => [id, 'NOT_RUN'])),
  mainnetFundingAllowed: false,
  publicReleaseAllowed: false,
};

test('accepts a not-run baseline without granting release permissions', () => {
  assert.equal(validateBaseline(validBaseline), true);
});

test('rejects a PASS gate without a corresponding evidence reference', () => {
  const candidate = structuredClone(validBaseline);
  candidate.gates.E02 = 'PASS';

  assert.throws(() => validateBaseline(candidate), /evidence/i);
});

test('rejects release permissions while any required gate is not PASS', () => {
  const candidate = structuredClone(validBaseline);
  candidate.mainnetFundingAllowed = true;

  assert.throws(() => validateBaseline(candidate), /gate|funding/i);
});
