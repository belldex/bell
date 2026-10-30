import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMainnetReferenceSpecs, buildReferenceAdapterMap } from './mainnet-reference-config.mjs';

const candidates = [
  { symbol: 'AAPL', token: '0x00000000000000000000000000000000000000a1', directAdjustedTokenUsd: { proxy: '0x00000000000000000000000000000000000000b1', decimals: 8, heartbeatSeconds: 86400 } },
  { symbol: 'NVDA', token: '0x00000000000000000000000000000000000000a2', directAdjustedTokenUsd: { proxy: '0x00000000000000000000000000000000000000b2', decimals: 8, heartbeatSeconds: 86400 } },
  { symbol: 'TSLA', token: '0x00000000000000000000000000000000000000a3', directAdjustedTokenUsd: { proxy: '0x00000000000000000000000000000000000000b3', decimals: 8, heartbeatSeconds: 86400 } },
];
const quoteFeeds = {
  ETH_USD: { proxy: '0x00000000000000000000000000000000000000c1', decimals: 8, heartbeatSeconds: 86400 },
  USDG_USD: { proxy: '0x00000000000000000000000000000000000000c2', decimals: 8, heartbeatSeconds: 86400 },
};

test('builds references for every mainnet stock plus WETH and USDG counterassets', () => {
  const specs = buildMainnetReferenceSpecs({ candidates, quoteFeeds, weth: '0x00000000000000000000000000000000000000d1', usdg: '0x00000000000000000000000000000000000000d2' });
  assert.deepEqual(specs.stocks.map((s) => s.symbol), ['AAPL', 'NVDA', 'TSLA']);
  assert.equal(specs.counterassets.WETH.feed, quoteFeeds.ETH_USD.proxy);
  assert.equal(specs.counterassets.USDG.feed, quoteFeeds.USDG_USD.proxy);
  assert.equal(specs.stocks[0].stockToken, candidates[0].token);
  assert.equal(specs.counterassets.WETH.stockToken, '0x0000000000000000000000000000000000000000');
});

test('uses feed decimals/heartbeat from candidate metadata and rejects unsupported values', () => {
  const specs = buildMainnetReferenceSpecs({ candidates, quoteFeeds, weth: '0x00000000000000000000000000000000000000d1', usdg: '0x00000000000000000000000000000000000000d2' });
  assert.equal(specs.stocks[1].decimals, 8);
  assert.equal(specs.stocks[1].heartbeatSeconds, 86400);
  assert.throws(() => buildMainnetReferenceSpecs({
    candidates: [{ ...candidates[0], directAdjustedTokenUsd: { ...candidates[0].directAdjustedTokenUsd, heartbeatSeconds: 0 } }],
    quoteFeeds,
    weth: '0x00000000000000000000000000000000000000d1',
    usdg: '0x00000000000000000000000000000000000000d2',
  }), /heartbeatSeconds/);
});

test('rejects duplicate stock symbols and zero/malformed addresses before deployment', () => {
  const base = { candidates, quoteFeeds, weth: '0x00000000000000000000000000000000000000d1', usdg: '0x00000000000000000000000000000000000000d2' };
  assert.throws(() => buildMainnetReferenceSpecs({ ...base, candidates: [candidates[0], candidates[0]] }), /duplicate symbol/);
  assert.throws(() => buildMainnetReferenceSpecs({ ...base, weth: '0x0000000000000000000000000000000000000000' }), /weth/);
});

test('normalizes deployed feed evidence into the exact pool-runner adapter lookup keys', () => {
  const map = buildReferenceAdapterMap({
    'AAPL/USD': { adapter: '0x00000000000000000000000000000000000000e1', feed: '0x00000000000000000000000000000000000000b1', sourceConfigHash: '0x' + '11'.repeat(32) },
    'WETH/USD': { adapter: '0x00000000000000000000000000000000000000e2', feed: '0x00000000000000000000000000000000000000c1', sourceConfigHash: '0x' + '22'.repeat(32) },
  });
  assert.equal(map['AAPL/USD'].adapter, '0x00000000000000000000000000000000000000e1');
  assert.equal(map['WETH/USD'].adapter, '0x00000000000000000000000000000000000000e2');
  assert.throws(() => buildReferenceAdapterMap({ AAPL: {} }), /end with \/USD/);
});
