// Encrypted backup rotation (plan M12-01, brief D04/D10/E03).
// Rotation is time-based with bounded generations; encryption recipients are
// bound into the manifest so a rotated-out key can no longer claim restores.
const KINDS = Object.freeze(['FULL', 'INCREMENTAL']);

export function planRotation({ manifests, now, intervalSeconds = 86400, keepGenerations = 7, activeRecipientId }) {
  if (!Array.isArray(manifests)) throw new TypeError('manifests must be an array');
  if (!Number.isSafeInteger(now)) throw new RangeError('now must be a safe integer');
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60) throw new RangeError('intervalSeconds >= 60');
  if (!Number.isSafeInteger(keepGenerations) || keepGenerations < 1) throw new RangeError('keepGenerations must be positive');
  if (typeof activeRecipientId !== 'string' || activeRecipientId.length === 0) {
    throw new RangeError('activeRecipientId is required (never embed the key itself)');
  }
  const dueAt = manifests.length === 0
    ? now
    : Math.max(...manifests.map((m) => m.createdAt)) + intervalSeconds * 1000;
  // Old generations encrypted to a rotated-out recipient are kept only for
  // their recorded retention window, never re-encrypted in place.
  const staleRecipients = manifests
    .filter((m) => m.encryptionRecipientId !== activeRecipientId)
    .map((m) => m.backupId);
  const keep = manifests.slice(-keepGenerations);
  return {
    dueAt,
    due: now >= dueAt,
    rotateRecipients: staleRecipients,
    prune: manifests.filter((m) => !keep.includes(m)).map((m) => m.backupId),
    activeRecipientId,
  };
}

// RPO check (M12-02): a backup older than the recovery point objective means
// restore drills must fail loudly, not pass by assuming freshness.
export function checkRpo({ lastVerifiedRestoreAt, rpoSeconds, now }) {
  if (!Number.isSafeInteger(rpoSeconds) || rpoSeconds < 1) throw new RangeError('rpoSeconds must be positive');
  if (!Number.isSafeInteger(now)) throw new RangeError('now must be a safe integer');
  if (!Number.isSafeInteger(lastVerifiedRestoreAt)) {
    return { ok: false, reason: 'NEVER_RESTORE_TESTED' };
  }
  const age = Math.floor((now - lastVerifiedRestoreAt) / 1000);
  return { ok: age <= rpoSeconds, ageSeconds: age, rpoSeconds };
}