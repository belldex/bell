import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAbiManifestCurrent, generateAbiManifest } from './abi-manifest.mjs';

const compilerOutput = {
  compilerVersion: '0.8.26',
  contracts: {
    'contracts/src/interfaces/IBellProtocol.sol': {
      ZInterface: { abi: [{ type: 'function', name: 'z' }] },
      AInterface: { abi: [{ type: 'function', name: 'a' }] },
    },
  },
};

test('generates a stable sorted ABI manifest with a hash bound to compiled interfaces', () => {
  const result = generateAbiManifest(compilerOutput);
  assert.deepEqual(Object.keys(result.interfaces), ['AInterface', 'ZInterface']);
  assert.equal(result.compilerVersion, '0.8.26');
  assert.match(result.abiSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(generateAbiManifest(compilerOutput), result);
  assert.equal(assertAbiManifestCurrent(result, structuredClone(result)), true);
  assert.throws(() => assertAbiManifestCurrent(result, { ...result, abiSha256: '0'.repeat(64) }), /stale/i);
});

test('refuses a compiled output missing protocol interfaces', () => {
  assert.throws(() => generateAbiManifest({ compilerVersion: '0.8.26', contracts: {} }), /interfaces/i);
});

test('includes declared protocol event and error ABIs with the interfaces', () => {
  const output = {
    compilerVersion: '0.8.26',
    contracts: {
      'contracts/src/interfaces/IBellProtocol.sol': { ISessionRegistry: { abi: [] } },
      'contracts/src/interfaces/ProtocolEvents.sol': { IBellEvents: { abi: [{ type: 'event', name: 'ClosureStarted' }] }, IBellErrors: { abi: [{ type: 'error', name: 'PolicyBlocked' }] } },
    },
  };
  const manifest = generateAbiManifest(output);
  assert.ok(manifest.interfaces.IBellEvents.some(({ name }) => name === 'ClosureStarted'));
  assert.ok(manifest.interfaces.IBellErrors.some(({ name }) => name === 'PolicyBlocked'));
});
