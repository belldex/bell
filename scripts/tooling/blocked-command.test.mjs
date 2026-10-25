import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedCommandMessage } from './blocked-command.mjs';

test('blocked scaffold commands explain missing work and never imply success', () => {
  assert.match(blockedCommandMessage('test:fork', 'authenticated RPC access'), /BLOCKED.*test:fork.*authenticated RPC access/i);
});

test('broadcast-like command names are rejected from the generic scaffold runner', () => {
  assert.throws(() => blockedCommandMessage('test:runtime', 'not applicable'), /not an allowed scaffold command/i);
  assert.throws(() => blockedCommandMessage('deploy:mainnet', 'owner approval'), /not an allowed scaffold command/i);
});
