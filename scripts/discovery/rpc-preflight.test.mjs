import test from 'node:test';
import assert from 'node:assert/strict';
import { probeChainHead, compareAtCommonBlock } from './rpc-preflight.mjs';

function mockClient(provider, headNumber, hash = `0x${'a'.repeat(64)}`) {
  return {
    provider,
    call: async (method, params) => {
      if (method === 'eth_chainId') return '0x1237';
      if (method === 'eth_getBlockByNumber' && params[0] === 'latest') return { number: `0x${headNumber.toString(16)}`, hash };
      if (method === 'eth_getBlockByNumber') return { number: params[0], hash };
      throw new Error(`unexpected ${method}`);
    },
  };
}

test('probes chain ID and head without returning the authenticated endpoint', async () => {
  const head = await probeChainHead(mockClient('alchemy', 100), 4663);
  assert.deepEqual(head, { provider: 'alchemy', chainId: 4663, blockNumber: 100n, blockHash: `0x${'a'.repeat(64)}` });
});

test('rejects wrong chain ID and malformed head identity', async () => {
  await assert.rejects(() => probeChainHead({ call: async () => '0x1', provider: 'pinax' }, 4663), { code: 'CHAIN_ID_MISMATCH' });
  await assert.rejects(() => probeChainHead({ provider: 'pinax', call: async (method) => method === 'eth_chainId' ? '0x1237' : { number: '0x1', hash: '0x1234' } }, 4663), { code: 'MALFORMED_HEAD' });
});

test('compares providers at the same common block, not their separate latest heads', async () => {
  const a = mockClient('alchemy', 100, `0x${'b'.repeat(64)}`);
  const b = mockClient('pinax', 102, `0x${'c'.repeat(64)}`);
  const headA = await probeChainHead(a, 4663);
  const headB = await probeChainHead(b, 4663);
  let queried;
  a.call = async (method, params) => { queried = params[0]; return { number: queried, hash: `0x${'d'.repeat(64)}` }; };
  b.call = async (_method, params) => ({ number: params[0], hash: `0x${'d'.repeat(64)}` });
  const result = await compareAtCommonBlock(a, headA, b, headB);
  assert.equal(result.agree, true);
  assert.equal(result.blockNumber, 100n);
  assert.equal(queried, '0x64');
});

test('reports a same-block provider disagreement as not agreeing', async () => {
  const a = mockClient('alchemy', 100, `0x${'b'.repeat(64)}`);
  const b = mockClient('pinax', 100, `0x${'c'.repeat(64)}`);
  const result = await compareAtCommonBlock(a, await probeChainHead(a, 4663), b, await probeChainHead(b, 4663));
  assert.equal(result.agree, false);
  assert.equal(result.reason, 'BLOCK_HASH_MISMATCH');
});
