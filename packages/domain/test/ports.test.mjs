import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimePorts } from '../src/ports.mjs';

const ports = {
  clock: { nowSeconds: () => 100 },
  fetch: async () => new Response('{}'),
  secrets: { get: async () => 'secret' },
  storage: { get: async () => null, put: async () => undefined },
  logger: { info() {}, warn() {}, error() {} },
  rpc: { call: async () => null },
};

test('accepts the runtime-neutral ports and returns a frozen boundary', () => {
  const result = createRuntimePorts(ports);
  assert.equal(result.clock.nowSeconds(), 100);
  assert.equal(Object.isFrozen(result), true);
});

test('rejects missing ports instead of silently falling back to runtime globals', () => {
  assert.throws(() => createRuntimePorts({ ...ports, rpc: undefined }), /rpc/i);
});

test('rejects an invalid clock result', () => {
  assert.throws(() => createRuntimePorts({ ...ports, clock: { nowSeconds: () => NaN } }).clock.nowSeconds(), /timestamp/i);
});
