import test from 'node:test';
import assert from 'node:assert/strict';
import { readEvidenceArtifact, validateBriefIdentity, validateReleaseIndex, verifyReleaseArtifacts } from './check-release.mjs';

const baseline = {
  briefSha256: 'a'.repeat(64),
  implementationPlanSha256: 'c'.repeat(64),
  gates: Object.fromEntries(['E01', 'E02', 'E03', 'E04', 'E05', 'E06'].map((id) => [id, 'NOT_RUN'])),
  mainnetFundingAllowed: false,
  publicReleaseAllowed: false,
};

test('accepts an evidence index whose document hashes and gates match the baseline', () => {
  assert.equal(validateReleaseIndex({ briefSha256: baseline.briefSha256, implementationPlanSha256: baseline.implementationPlanSha256, gates: baseline.gates, artifactHashes: {} }, baseline), true);
});

test('rejects a PASS gate without a hashed artifact', () => {
  const release = structuredClone(baseline);
  release.gates.E02 = 'PASS';
  assert.throws(() => validateReleaseIndex({ ...release, artifactHashes: {} }, baseline), /artifact|evidence/i);
});

test('rejects evidence index that weakens a baseline gate status', () => {
  const release = structuredClone(baseline);
  release.gates.E01 = 'PASS';
  assert.throws(() => validateReleaseIndex({ ...release, artifactHashes: { 'e01.json': 'b'.repeat(64) } }, baseline), /match|baseline/i);
});

test('rejects a changed brief whose SHA-256 differs from the release baseline', () => {
  assert.throws(() => validateBriefIdentity('a'.repeat(64), 'b'.repeat(64)), /SHA-256/i);
});

test('verifies gate artifact content hashes instead of trusting declared hex strings', async () => {
  const bytes = Buffer.from('{"candidate":true}');
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const evidence = {
    gates: { E02: 'PASS' },
    evidenceByGate: { E02: ['evidence/build.json'] },
    artifactHashes: { 'evidence/build.json': digest },
  };
  assert.equal(await verifyReleaseArtifacts(evidence, async () => bytes), true);
  await assert.rejects(() => verifyReleaseArtifacts({ ...evidence, artifactHashes: { 'evidence/build.json': '0'.repeat(64) } }, async () => bytes), /hash mismatch/i);
  await assert.rejects(() => verifyReleaseArtifacts(evidence, async () => { throw new Error('missing'); }), /missing/i);
  await assert.rejects(() => readEvidenceArtifact('.', '../outside.json'), /unsafe/i);
});
