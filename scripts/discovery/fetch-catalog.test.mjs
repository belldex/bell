import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPublicDiscovery } from './fetch-catalog.mjs';

test('fetches only official public metadata and returns a reproducible raw-response hash', async () => {
  let requested;
  const body = JSON.stringify({ feeds: [] });
  const result = await fetchPublicDiscovery({
    networkType: 'mainnet',
    assets: ['AAPL', 'NVDA', 'TSLA'],
    fetchImpl: async (url, init) => {
      requested = { url: new URL(url), init };
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(requested.url.origin, 'https://api.dataengine.chain.link');
  assert.equal(requested.url.searchParams.get('base_asset'), 'AAPL,NVDA,TSLA');
  assert.equal(requested.init.headers.Authorization, undefined);
  assert.equal(result.sha256.length, 64);
  assert.deepEqual(result.payload, { feeds: [] });
});

test('rejects non-success responses instead of treating empty metadata as healthy', async () => {
  await assert.rejects(() => fetchPublicDiscovery({
    networkType: 'mainnet', assets: ['AAPL'], fetchImpl: async () => new Response('{}', { status: 403 }),
  }), /HTTP 403/i);
});

test('rejects an unsupported chain selector', async () => {
  await assert.rejects(() => fetchPublicDiscovery({ networkType: 'unknown', assets: ['AAPL'] }), /networkType/i);
});
