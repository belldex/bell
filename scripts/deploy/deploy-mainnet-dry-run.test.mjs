import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runner = await readFile(new URL('./deploy-mainnet.mjs', import.meta.url), 'utf8');
const foundryScript = await readFile(new URL('../../contracts/script/DeployTestnet.s.sol', import.meta.url), 'utf8');

test('default Forge invocation cannot broadcast', () => {
  assert.match(runner, /buildForgeArgs\(/);
  assert.match(runner, /broadcast\s*\}\)/);
  assert.match(runner, /No transaction will be sent/);
});

test('dry-run directs Solidity manifest writes outside evidence', () => {
  assert.match(runner, /BELL_MANIFEST_PATH/);
  assert.match(foundryScript, /vm\.envOr\("BELL_MANIFEST_PATH"/);
});

test('dry-run restores or removes the manifest and cleans isolated output', () => {
  assert.match(runner, /cleanupDryRunArtifacts\(/);
  assert.match(runner, /previousManifest/);
  assert.match(runner, /isolatedDir/);
});
