import test from 'node:test';
import assert from 'node:assert/strict';
import * as capabilityProbe from './rpc-capability-probe.mjs';

const hash = `0x${'a'.repeat(64)}`;
const dummy = '0x0000000000000000000000000000000000000001';

function rpcClient({ provider = 'alchemy', failMethods = [] } = {}) {
  const calls = [];
  return {
    provider,
    calls,
    async call(method, params) {
      calls.push({ method, params });
      if (failMethods.includes(method)) {
        const error = new Error('temporary remote error');
        error.code = method === 'eth_getLogs' ? 'QUOTA_EXCEEDED' : 'METHOD_UNSUPPORTED';
        throw error;
      }
      if (method === 'eth_chainId') return '0x1237';
      if (method === 'eth_getBlockByNumber') {
        const number = params[0] === 'latest' ? '0x1000' : params[0];
        return { number, hash };
      }
      if (method === 'eth_blockNumber') return '0x1000';
      if (method === 'eth_getCode') return '0x6000';
      if (method === 'eth_getTransactionCount') return '0x2';
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_gasPrice') return '0x3b9aca00';
      if (method === 'eth_call') return '0x';
      if (method === 'eth_getLogs') return [];
      if (method === 'eth_getTransactionReceipt') return null;
      throw new Error(`unexpected method ${method}`);
    },
  };
}

test('capability probe checks required read-only methods and bounded archive/log ranges', async () => {
  const client = rpcClient({ provider: 'alchemy' });
  const report = await capabilityProbe.probeRpcCapabilities({ client, expectedChainId: 4663 });
  assert.equal(report.provider, 'alchemy');
  assert.equal(report.chainId, 4663);
  assert.equal(report.head.blockNumber, '4096');
  assert.equal(report.status, 'CAPABILITIES_OK');
  for (const key of ['code', 'nonce', 'gasPrice', 'estimateGas', 'historicalBlock', 'historicalCall', 'boundedLogs', 'receipt']) {
    assert.equal(report.checks[key].ok, true, `${key} should be available`);
  }
  const logRequest = client.calls.find(({ method }) => method === 'eth_getLogs').params[0];
  assert.equal(BigInt(logRequest.toBlock) - BigInt(logRequest.fromBlock) + 1n, 10n);
  assert.equal(report.mainnetBroadcastAllowed, false);
});

test('unsupported or quota-limited methods remain explicit without leaking raw errors', async () => {
  const client = rpcClient({ provider: 'pinax', failMethods: ['eth_estimateGas', 'eth_getLogs'] });
  const report = await capabilityProbe.probeRpcCapabilities({ client, expectedChainId: 4663 });
  assert.equal(report.status, 'CAPABILITY_GAPS');
  assert.equal(report.checks.estimateGas.code, 'METHOD_UNSUPPORTED');
  assert.equal(report.checks.boundedLogs.code, 'QUOTA_EXCEEDED');
  assert.equal(JSON.stringify(report).includes('temporary remote error'), false);
});

test('wrong chain and invalid provider fail closed', async () => {
  const wrongChain = rpcClient();
  wrongChain.call = async (method) => method === 'eth_chainId' ? '0x1' : null;
  await assert.rejects(capabilityProbe.probeRpcCapabilities({ client: wrongChain, expectedChainId: 4663 }), /chain ID/i);
  await assert.rejects(capabilityProbe.probeRpcCapabilities({ client: { ...rpcClient(), provider: 'unknown' }, expectedChainId: 4663 }), /client/i);
});
