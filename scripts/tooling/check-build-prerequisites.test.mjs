import test from 'node:test';
import assert from 'node:assert/strict';
import { getMissingBuildPrerequisites } from './check-build-prerequisites.mjs';

test('reports missing Foundry and Solidity compiler as blocked build prerequisites', () => {
  const missing = getMissingBuildPrerequisites({ forge: false, solc: false, lockComplete: false });
  assert.deepEqual(missing, ['Foundry (forge)', 'Solidity compiler (solc)', 'complete pinned compatibility lock']);
});

test('does not block a build when the pinned toolchain is available', () => {
  assert.deepEqual(getMissingBuildPrerequisites({ forge: true, solc: true, lockComplete: true }), []);
});
