import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpcClient, RpcProbeError } from './rpc-client.mjs';

test('sends allowlisted JSON-RPC requests and correlates the response ID', async () => {
  let body;
  const client = createRpcClient({
    provider: 'alchemy',
    networkType: 'mainnet',
    endpoint: 'https://robinhood-mainnet.g.alchemy.com/v2/private-key',
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({ jsonrpc: '2.0', id: body.id, result: '0x1234' });
    },
  });
  assert.equal(client.provider, 'alchemy');
  assert.equal(await client.call('eth_chainId', []), '0x1234');
  assert.equal(body.method, 'eth_chainId');
  assert.equal(body.jsonrpc, '2.0');
});

test('redacts endpoint credentials from authentication and transport errors', async () => {
  const endpoint = 'https://robinhood.rpc.pinax.network/v1/do-not-leak-this-key/';
  const client = createRpcClient({ provider: 'pinax', networkType: 'mainnet', endpoint, fetchImpl: async () => new Response('', { status: 403 }) });
  await assert.rejects(() => client.call('eth_chainId', []), (error) => {
    assert.ok(error instanceof RpcProbeError);
    assert.equal(error.code, 'AUTH_OR_ENTITLEMENT');
    assert.equal(error.message.includes('do-not-leak-this-key'), false);
    return true;
  });
});

test('distinguishes unsupported methods and rejects methods outside the probe allowlist', async () => {
  const client = createRpcClient({
    provider: 'pinax', networkType: 'mainnet', endpoint: 'https://robinhood.rpc.pinax.network/v1/test-key/',
    fetchImpl: async (_url, init) => Response.json({ jsonrpc: '2.0', id: JSON.parse(init.body).id, error: { code: -32601, message: 'method not found' } }),
  });
  await assert.rejects(() => client.call('eth_getBlockByNumber', ['latest', false]), { code: 'METHOD_UNSUPPORTED' });
  await assert.rejects(() => client.call('personal_unlockAccount', []), { code: 'METHOD_NOT_ALLOWED' });
  await assert.rejects(() => client.call('eth_sendRawTransaction', ['0xdead']), { code: 'METHOD_NOT_ALLOWED' });
});

test('rejects invalid provider identity and endpoint protocols', () => {
  assert.throws(() => createRpcClient({ provider: 'unknown', endpoint: 'https://rpc.example' }), /provider/i);
  assert.throws(() => createRpcClient({ provider: 'alchemy', networkType: 'mainnet', endpoint: 'https://rpc.example.invalid/v2/key' }), /official Robinhood endpoint/i);
  assert.throws(() => createRpcClient({ provider: 'pinax', networkType: 'mainnet', endpoint: 'https://robinhood.rpc.pinax.network/v1/' }), /credential/i);
  assert.throws(() => createRpcClient({ provider: 'alchemy', networkType: 'mainnet', endpoint: 'file:///tmp/rpc' }), /HTTPS/i);
  assert.doesNotThrow(() => createRpcClient({ provider: 'pinax', networkType: 'testnet', endpoint: 'https://robsepolia.rpc.pinax.network/v1/key/' }));
  assert.throws(() => createRpcClient({ provider: 'pinax', networkType: 'testnet', endpoint: 'https://robinhood.rpc.pinax.network/v1/key/' }), /official Robinhood endpoint/i);
  assert.throws(() => createRpcClient({ provider: 'alchemy', networkType: 'mainnet', endpoint: 'https://robinhood-mainnet.g.alchemy.com:8443/v2/key' }), /port/i);
});
