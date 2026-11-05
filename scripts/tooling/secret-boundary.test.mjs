import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSecretBoundary } from './secret-boundary.mjs';

test('example env and untrusted PR workflow expose no signing credentials or secrets', async () => {
  const envExample = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../../.github/workflows/pr.yml', import.meta.url), 'utf8');
  assert.equal(validateSecretBoundary({ envExample, workflow }), true);
});

test('rejects a private key in NEXT_PUBLIC and a secret-bearing pull request workflow', () => {
  assert.throws(() => validateSecretBoundary({ envExample: 'NEXT_PUBLIC_KEEPER_PRIVATE_KEY=abc', workflow: 'on: pull_request' }), /NEXT_PUBLIC/i);
  assert.throws(() => validateSecretBoundary({ envExample: 'KEEPER_PRIVATE_KEY=', workflow: 'on: pull_request\n${{ secrets.PROD_KEY }}' }), /secret|credential/i);
});

test('allows the public auction contract address but rejects a credential-bearing browser RPC URL', () => {
  const workflow = 'on: pull_request\npermissions:\n  contents: read\njobs:\n  test:\n    steps:\n      - uses: actions/checkout@0000000000000000000000000000000000000000';
  assert.equal(validateSecretBoundary({
    envExample: 'NEXT_PUBLIC_BELL_AUCTION_REGISTRY=0x0000000000000000000000000000000000000001',
    workflow,
  }), true);
  assert.throws(() => validateSecretBoundary({
    envExample: 'NEXT_PUBLIC_BELL_RPC_URL=https://rpc.example/?key=secret',
    workflow,
  }), /NEXT_PUBLIC/i);
});
