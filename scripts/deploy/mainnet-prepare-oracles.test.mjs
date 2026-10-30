import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const run = (args) => spawnSync(process.execPath, ['scripts/deploy/mainnet-prepare-oracles.mjs', ...args], { encoding: 'utf8' });

test('prepare CLI requires both explicit pair arguments before reading credentials or making requests', () => {
  for (const args of [[], ['--stock=AAPL'], ['--counterasset=WETH']]) {
    const result = run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /explicit --stock and --counterasset/);
  }
});

test('prepare CLI refuses an unauthorized broadcast before reading credentials or making requests', () => {
  const result = run(['--stock=AAPL', '--counterasset=NVDA', '--broadcast']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--i-authorize-spend/);
});
