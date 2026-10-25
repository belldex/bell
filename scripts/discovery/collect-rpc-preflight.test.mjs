import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRpcPreflight } from './collect-rpc-preflight.mjs';

const mockClient = (provider, blockNumber, hash = `0x${'a'.repeat(64)}`) => ({
  provider,
  call: async (method, params) => method === 'eth_chainId'
    ? '0x1237'
    : params[0] === 'latest'
      ? { number: `0x${blockNumber.toString(16)}`, hash }
      : { number: params[0], hash },
});

test('keeps both providers required and records head agreement without granting signing permission', async () => {
  const result = await collectRpcPreflight({
    expectedChainId: 4663,
    primary: mockClient('alchemy', 100),
    secondary: mockClient('pinax', 102),
  });
  assert.equal(result.status, 'HEADS_AGREE_ONLY');
  assert.equal(result.commonBlock, '100');
  assert.equal(result.providersAgree, true);
  assert.equal(result.mainnetBroadcastAllowed, false);
});

test('does not treat a missing secondary provider as agreement or allow signing', async () => {
  const result = await collectRpcPreflight({ expectedChainId: 4663, primary: mockClient('alchemy', 100), secondary: null });
  assert.equal(result.status, 'BLOCKED_ACCESS');
  assert.equal(result.providersAgree, false);
  assert.equal(result.mainnetBroadcastAllowed, false);
});

test('provider disagreement is explicit and blocks signing', async () => {
  const result = await collectRpcPreflight({
    expectedChainId: 4663,
    primary: mockClient('alchemy', 100, `0x${'b'.repeat(64)}`),
    secondary: mockClient('pinax', 101, `0x${'c'.repeat(64)}`),
  });
  assert.equal(result.status, 'PROVIDER_DISAGREEMENT');
  assert.equal(result.providersAgree, false);
  assert.equal(result.mainnetBroadcastAllowed, false);
});

test('common-block read failure is recorded as unavailable, not a healthy failover', async () => {
  const primary = mockClient('alchemy', 100);
  const secondary = mockClient('pinax', 100);
  secondary.call = async (method, params) => {
    if (method === 'eth_chainId') return '0x1237';
    if (params[0] === 'latest') return { number: '0x64', hash: `0x${'a'.repeat(64)}` };
    throw Object.assign(new Error('archive unavailable'), { code: 'ARCHIVE_UNAVAILABLE' });
  };
  const result = await collectRpcPreflight({ expectedChainId: 4663, primary, secondary });
  assert.equal(result.status, 'COMMON_BLOCK_UNAVAILABLE');
  assert.equal(result.providersAgree, false);
  assert.equal(result.mainnetBroadcastAllowed, false);
});
