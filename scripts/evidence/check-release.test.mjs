import test from 'node:test';
import assert from 'node:assert/strict';
import { readEvidenceArtifact, validateBriefIdentity, validateReleaseIndex, validateReleaseIndexDocument, validateTaskStatus, verifyReleaseArtifacts } from './check-release.mjs';

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

test('the descriptive release index cannot keep a superseded brief hash', () => {
  const document = {
    planSnapshot: { briefSha256: 'b'.repeat(64), implementationPlanSha256: baseline.implementationPlanSha256 },
    gateStatus: { E01_build: 'NOT_RUN', E02_deployment: 'NOT_RUN', E03_source_capacity: 'NOT_RUN', E04_sessions_four_weekends: 'NOT_RUN', E05_audit_retest: 'NOT_RUN', E06_public_release: 'NOT_RUN' },
    mainnetFundingAllowed: false,
    publicReleaseAllowed: false,
  };
  assert.throws(() => validateReleaseIndexDocument(document, baseline), /brief hash/i);
});

test('the descriptive release index must report every gate and cannot grant release', () => {
  const ok = {
    planSnapshot: { briefSha256: baseline.briefSha256, implementationPlanSha256: baseline.implementationPlanSha256 },
    gateStatus: { E01_build: 'NOT_RUN', E02_deployment: 'NOT_RUN', E03_source_capacity: 'NOT_RUN', E04_sessions_four_weekends: 'NOT_RUN', E05_audit_retest: 'NOT_RUN', E06_public_release: 'NOT_RUN' },
    mainnetFundingAllowed: false,
    publicReleaseAllowed: false,
  };
  assert.equal(validateReleaseIndexDocument(ok, baseline), true);
  assert.throws(() => validateReleaseIndexDocument({ ...ok, gateStatus: { E01_build: 'NOT_RUN' } }, baseline), /does not report gate/i);
  assert.throws(() => validateReleaseIndexDocument({ ...ok, publicReleaseAllowed: true }, baseline), /cannot grant/i);
});

test('the task ledger cannot keep a superseded brief hash', () => {
  const tasks = { 'M00-01': { title: 'x', status: 'NOT_STARTED', evidence: [], blockers: [] } };
  const ledger = { planTaskCount: 1, implementationPlanSha256: 'c'.repeat(64), briefSha256: 'd'.repeat(64), tasks };
  assert.throws(() => validateTaskStatus(ledger, 1, 'c'.repeat(64), 'a'.repeat(64)), /brief hash/i);
  assert.equal(validateTaskStatus({ ...ledger, briefSha256: 'a'.repeat(64) }, 1, 'c'.repeat(64), 'a'.repeat(64)), true);
});
