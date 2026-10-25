import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectCandidateManifest } from '../src/source-manifest.mjs';

async function loadManifest() {
  return JSON.parse(await readFile(new URL('../../../config/assets/candidates.mainnet.json', import.meta.url), 'utf8'));
}

test('accepts documented metadata but keeps assets unadmitted until source and onchain evidence exists', async () => {
  const result = inspectCandidateManifest(await loadManifest());
  assert.equal(result.valid, true);
  assert.equal(result.admitted.length, 0);
  assert.equal(result.candidates.length, 3);
  assert.ok(result.blockers.includes('authenticatedCommonBlockReads'));
  assert.ok(result.assets.every((asset) => asset.admissionReasons.length > 0));
});

test('rejects duplicate feed identity, bad schema, or a claimed admission without evidence', async () => {
  const base = await loadManifest();
  const duplicate = structuredClone(base);
  duplicate.assets[1].streamsV11.REGULAR = duplicate.assets[0].streamsV11.REGULAR;
  assert.equal(inspectCandidateManifest(duplicate).valid, false);

  const wrongSchema = structuredClone(base);
  wrongSchema.assets[0].schemaVersion = 10;
  assert.equal(inspectCandidateManifest(wrongSchema).valid, false);

  const falseAdmission = structuredClone(base);
  falseAdmission.assets[0].admitted = true;
  assert.equal(inspectCandidateManifest(falseAdmission).valid, false);
});
