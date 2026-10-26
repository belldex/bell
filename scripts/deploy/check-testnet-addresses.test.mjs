import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST_CONTRACT_KEYS, compareAddressSources, compareCodeSizes } from './check-testnet-addresses.mjs';

const addr = (n) => `0x${n.toString(16).padStart(40, '0')}`;

function sources(overrides = {}) {
  const manifest = { chainId: 46630, deployer: addr(1), permit2: addr(2), feeToken: addr(3) };
  const status = { chainId: 46630, contracts: { permit2: addr(2) } };
  const verification = { chainId: 46630, deployer: addr(1), sourceCommit: 'abc1234', contracts: {} };
  for (const [i, key] of MANIFEST_CONTRACT_KEYS.entries()) {
    manifest[key] = addr(100 + i);
    status.contracts[key] = addr(100 + i);
    verification.contracts[key] = { address: addr(100 + i), codeBytes: 1000 + i };
  }
  verification.contracts.feeToken = { address: addr(3), codeBytes: 900 };
  return { manifest: { ...manifest, ...overrides.manifest }, status, verification: { ...verification, ...overrides.verification } };
}

test('accepts three sources that agree', () => {
  const result = compareAddressSources(sources());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
});

test('catches a status module that still points at a superseded address', () => {
  const input = sources();
  input.status.contracts.poolManager = addr(999);
  const result = compareAddressSources(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /poolManager drift/);
});

test('catches stale verification evidence from a previous deploy', () => {
  const input = sources();
  input.verification.contracts.router = { address: addr(998), codeBytes: 10 };
  const result = compareAddressSources(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /router drift/);
});

test('catches a verification deployer that does not match the manifest', () => {
  const result = compareAddressSources(sources({ verification: { deployer: addr(7) } }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /deployer/);
});

test('warns when verification does not record the source commit', () => {
  const result = compareAddressSources(sources({ verification: { sourceCommit: undefined } }));
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
});

test('rejects a manifest on the wrong chain', () => {
  const result = compareAddressSources(sources({ manifest: { chainId: 4663 } }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /chainId/);
});

test('code sizes must match what the chain reports', () => {
  const { verification } = sources();
  const actual = {};
  for (const [key, recorded] of Object.entries(verification.contracts)) actual[key] = recorded.codeBytes;
  assert.equal(compareCodeSizes({ verification, actualSizes: actual }).ok, true);

  actual.router = 1;
  const drift = compareCodeSizes({ verification, actualSizes: actual });
  assert.equal(drift.ok, false);
  assert.match(drift.errors.join('\n'), /router code size drift/);

  actual.router = 0;
  assert.match(compareCodeSizes({ verification, actualSizes: actual }).errors.join('\n'), /no code/);
});
