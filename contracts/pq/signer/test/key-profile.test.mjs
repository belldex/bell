import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveKeyProfile } from '../key-profile.mjs';

test('Mainnet signer profile uses a separate key directory and encryption variable', () => {
  const profile = resolveKeyProfile('robinhood-4663', 'D:/bell/contracts/pq/signer');
  assert.equal(profile.keyDir, path.resolve('D:/bell/contracts/pq/keys/robinhood-4663'));
  assert.equal(profile.encryptionEnv, 'BELL_PQ_MAINNET_ENCRYPTION_KEY');
});

test('signer refuses an unrecognized profile instead of choosing another key directory', () => {
  assert.throws(() => resolveKeyProfile('mainnet', 'D:/bell/contracts/pq/signer'), /Unsupported PQ key profile/);
});
