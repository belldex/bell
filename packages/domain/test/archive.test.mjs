import test from 'node:test';
import assert from 'node:assert/strict';
import { objectKey, buildManifest, planPrune } from '../src/archive.mjs';

test('object keys are immutable and versioned: retries never overwrite a restore source', () => {
  const a = objectKey({ kind: 'CAPTURE', scope: 'aapl', version: 1, timestamp: 1000 });
  const retry = objectKey({ kind: 'CAPTURE', scope: 'aapl', version: 2, timestamp: 1000 });
  assert.notEqual(a, retry);
  assert.throws(() => objectKey({ kind: 'NOPE', scope: 'x', version: 1, timestamp: 1 }), /kind/);
  assert.throws(() => objectKey({ kind: 'CAPTURE', scope: 'x', version: 0, timestamp: 1 }), /version/);
});

test('manifest carries size, hash and license metadata; entitled raw reports are rejected', async () => {
  const manifest = await buildManifest({
    kind: 'CAPTURE', scope: 'aapl', createdAt: 1,
    objects: [{ key: 'k1', bytes: 'hello' }, { key: 'k2', bytes: 'world', licenseScope: 'PUBLIC' }],
  });
  assert.equal(manifest.totalSize, 10);
  assert.equal(manifest.entries[0].licenseScope, 'NONE');
  assert.match(manifest.manifestHash, /^[0-9a-f]{64}$/);
  await assert.rejects(
    () => buildManifest({ kind: 'ACTIVE', scope: 'x', createdAt: 1, objects: [{ key: 'k', bytes: 'raw' }], licenseScope: 'ENTITLED' }),
    /never enter a public archive/,
  );
  await assert.rejects(
    () => buildManifest({ kind: 'CAPTURE', scope: 'x', createdAt: 1, objects: [] }),
    /non-empty/,
  );
});

test('prune runs only after verified export; unverified manifests block, not delete', async () => {
  const m1 = await buildManifest({ kind: 'ANALYTICS', scope: 's', createdAt: 1, objects: [{ key: 'a', bytes: '1' }] });
  const m2 = await buildManifest({ kind: 'ANALYTICS', scope: 's', createdAt: 2, objects: [{ key: 'b', bytes: '2' }] });
  const m3 = await buildManifest({ kind: 'ANALYTICS', scope: 's', createdAt: 3, objects: [{ key: 'c', bytes: '3' }] });
  const noExport = planPrune({ manifests: [m1, m2, m3], maxObjects: 1 });
  assert.deepEqual(noExport.prune, []);
  assert.equal(noExport.blocked.length, 2);
  assert.equal(noExport.overThreshold, true);
  const exported = planPrune({ manifests: [m1, m2, m3], maxObjects: 1, exportedManifestHashes: [m1.manifestHash, m2.manifestHash] });
  assert.equal(exported.prune.length, 2);
  assert.equal(exported.blocked.length, 0);
  assert.equal(exported.overThreshold, false);
});

test('duplicate upload of the same payload yields a deterministic manifest hash', async () => {
  const a = await buildManifest({ kind: 'INCIDENT', scope: 's', createdAt: 1, objects: [{ key: 'k', bytes: 'same' }] });
  const b = await buildManifest({ kind: 'INCIDENT', scope: 's', createdAt: 1, objects: [{ key: 'k', bytes: 'same' }] });
  assert.equal(a.manifestHash, b.manifestHash);
});
