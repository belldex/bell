import test from 'node:test';
import assert from 'node:assert/strict';
import { planRotation, checkRpo } from '../src/backup.mjs';

const manifest = (id, createdAt, recipientId = 'recipient-current') => ({ backupId: id, createdAt, encryptionRecipientId: recipientId });

test('rotation becomes due after the interval from the newest manifest', () => {
  const plan = planRotation({ manifests: [manifest('a', 0), manifest('b', 86_000_000)], now: 172_400_000, activeRecipientId: 'recipient-current' });
  assert.equal(plan.due, true);
  assert.equal(plan.dueAt, 86_000_000 + 86_400_000);
  const early = planRotation({ manifests: [manifest('a', 0), manifest('b', 86_000_000)], now: 100_000_000, activeRecipientId: 'recipient-current' });
  assert.equal(early.due, false);
});

test('generations are bounded; prune lists only what falls outside the window', () => {
  const manifests = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => manifest(id, i));
  const plan = planRotation({ manifests, now: 0, activeRecipientId: 'recipient-current', keepGenerations: 7 });
  assert.deepEqual(plan.prune, ['a']);
});

test('rotated-out encryption recipients are flagged, never re-encrypted in place', () => {
  const plan = planRotation({
    manifests: [manifest('old', 1, 'recipient-old'), manifest('new', 2, 'recipient-current')],
    now: 0, activeRecipientId: 'recipient-current',
  });
  assert.deepEqual(plan.rotateRecipients, ['old']);
});

test('recipient id is mandatory and keys never appear in the plan', () => {
  assert.throws(() => planRotation({ manifests: [], now: 0, activeRecipientId: '' }), /activeRecipientId/);
  const plan = planRotation({ manifests: [], now: 0, activeRecipientId: 'r1' });
  assert.equal(JSON.stringify(plan).includes('private-key'), false);
});

test('RPO check fails loudly without a verified restore and on stale restores', () => {
  assert.deepEqual(checkRpo({ lastVerifiedRestoreAt: null, rpoSeconds: 3600, now: 1000 }), { ok: false, reason: 'NEVER_RESTORE_TESTED' });
  const stale = checkRpo({ lastVerifiedRestoreAt: 0, rpoSeconds: 3600, now: 7_200_000 });
  assert.equal(stale.ok, false);
  assert.equal(stale.ageSeconds, 7200);
  const ok = checkRpo({ lastVerifiedRestoreAt: 3_600_000, rpoSeconds: 3600, now: 3_600_000 });
  assert.equal(ok.ok, true);
});