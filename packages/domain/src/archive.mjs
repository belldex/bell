// Bounded object archive (plan M07-04, brief D04/D10).
// Immutable versioned keys, manifest with size/hash/license metadata,
// active/capture/incident separated from replayable analytics, and pruning
// that only ever runs after a verified export exists.
// Runtime-neutral: hashing uses Web Crypto (Node 24 / Deno / Workers).

const ARCHIVE_KINDS = Object.freeze(['ACTIVE', 'CAPTURE', 'INCIDENT', 'ANALYTICS']);

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return new TextEncoder().encode(value);
  throw new TypeError('bytes must be a string or Uint8Array');
}

export function objectKey({ kind, scope, version, timestamp }) {
  if (!ARCHIVE_KINDS.includes(kind)) throw new RangeError(`kind must be one of ${ARCHIVE_KINDS.join('|')}`);
  if (typeof scope !== 'string' || scope.length === 0) throw new RangeError('scope is required');
  if (!Number.isSafeInteger(version) || version < 1) throw new RangeError('version must start at 1');
  if (!Number.isSafeInteger(timestamp)) throw new RangeError('timestamp must be a safe integer');
  // Versioned keys are append-only: a retry re-uploads a NEW version instead
  // of overwriting one that a restore may still need.
  return `bell/${kind.toLowerCase()}/${scope}/v${version}/${timestamp}`;
}

export async function buildManifest({ kind, scope, objects, licenseScope, createdAt }) {
  if (!ARCHIVE_KINDS.includes(kind)) throw new RangeError('kind is invalid');
  if (!Array.isArray(objects) || objects.length === 0) throw new RangeError('objects must be non-empty');
  let totalSize = 0;
  const entries = [];
  for (const object of objects) {
    const bytes = asBytes(object.bytes);
    totalSize += bytes.length;
    entries.push({
      key: object.key,
      size: bytes.length,
      sha256: await sha256Hex(bytes),
      licenseScope: object.licenseScope ?? licenseScope ?? 'NONE',
    });
  }
  if (licenseScope === 'ENTITLED' && kind === 'ACTIVE') {
    throw new RangeError('entitled raw reports never enter a public archive path');
  }
  const manifestHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(entries)));
  return { kind, scope, entries, totalSize, manifestHash, createdAt };
}

export function planPrune({ manifests, maxObjects, exportedManifestHashes = [] }) {
  if (!Array.isArray(manifests)) throw new TypeError('manifests must be an array');
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1) throw new RangeError('maxObjects must be positive');
  const exported = new Set(exportedManifestHashes);
  const keep = manifests.slice(-maxObjects);
  const prunable = manifests.filter((m) => !keep.includes(m));
  const blocked = prunable.filter((m) => !exported.has(m.manifestHash));
  // Verified-export-before-prune: unverified manifests stay. The threshold is
  // only violated when the post-prune retention would still exceed maxObjects.
  const pruneList = prunable.filter((m) => exported.has(m.manifestHash)).map((m) => m.manifestHash);
  const overThreshold = manifests.length - pruneList.length > maxObjects;
  return {
    prune: pruneList,
    blocked: blocked.map((m) => m.manifestHash),
    overThreshold,
  };
}
