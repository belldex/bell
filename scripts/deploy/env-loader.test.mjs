import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from './env-loader.mjs';

test('loads an explicitly selected environment file and keeps process values authoritative', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bell-env-'));
  try {
    const filePath = join(dir, 'production.env');
    writeFileSync(filePath, 'RPC_URL=https://rpc.example\nDEPLOYER_KEY=from-file\n');
    assert.deepEqual(loadEnvFile({ filePath, base: { DEPLOYER_KEY: 'from-process' } }), {
      RPC_URL: 'https://rpc.example', DEPLOYER_KEY: 'from-process',
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('allows callers to use inherited environment without a local .env file', () => {
  assert.deepEqual(loadEnvFile({ filePath: 'missing-bell-test.env', base: { RPC_URL: 'https://rpc.example' }, optional: true }), {
    RPC_URL: 'https://rpc.example',
  });
});
