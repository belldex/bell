import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionRegistry } from './keeper-price-config.mjs';

test('uses the current deployment manifest when no registry override is set', () => {
  assert.equal(
    resolveSessionRegistry({}, { sessionRegistry: '0x1de6199618ddb2b5fdb869113e4b906628db168e' }),
    '0x1de6199618ddb2b5fdb869113e4b906628db168e',
  );
});

test('allows an explicit session registry override', () => {
  assert.equal(
    resolveSessionRegistry({ BELL_SESSION_REGISTRY: '0x1111111111111111111111111111111111111111' }, { sessionRegistry: '0x2222222222222222222222222222222222222222' }),
    '0x1111111111111111111111111111111111111111',
  );
});
