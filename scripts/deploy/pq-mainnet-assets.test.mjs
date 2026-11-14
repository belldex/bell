import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPQManifestBroadcastable, buildPQMainnetAssetQueue } from './pq-mainnet-assets.mjs';

const b32 = (byte) => `0x${byte.repeat(32)}`;

test('maps the PQ genesis descriptor IDs to the full stock set and USDG', () => {
  const manifest = {
    chainId: 4663,
    sourceMode: 'existing-onchain-chainlink',
    assetIds: [b32('a1'), b32('a2'), b32('a3'), b32('a4')],
    assetDescriptors: {
      AAPL: { descriptorId: b32('a1'), token: '0x0000000000000000000000000000000000000001' },
      NVDA: { descriptorId: b32('a2'), token: '0x0000000000000000000000000000000000000002' },
      TSLA: { descriptorId: b32('a3'), token: '0x0000000000000000000000000000000000000003' },
      USDG: { descriptorId: b32('a4'), token: '0x0000000000000000000000000000000000000099' },
    },
  };
  const adapters = {
    chainId: 4663,
    assets: Object.fromEntries(['AAPL', 'NVDA', 'TSLA'].map((symbol, index) => [symbol, {
      stockToken: `0x${String(index + 1).padStart(40, '0')}`,
      directAdapter: `0x${String(index + 11).padStart(40, '0')}`,
      regularAdapter: `0x${String(index + 21).padStart(40, '0')}`,
      extendedAdapter: `0x${String(index + 31).padStart(40, '0')}`,
      overnightAdapter: `0x${String(index + 41).padStart(40, '0')}`,
    }])) ,
  };
  const result = buildPQMainnetAssetQueue({ manifest, adapters });

  assert.deepEqual(Object.keys(result.stocks), ['AAPL', 'NVDA', 'TSLA']);
  assert.deepEqual(Object.values(result.stocks).map(({ descriptorId }) => descriptorId), manifest.assetIds.slice(0, 3));
  assert.deepEqual(Object.values(result.stocks).map(({ token }) => token), Object.values(adapters.assets).map(({ stockToken }) => stockToken));
  assert.equal(result.usdg.descriptorId, manifest.assetIds[3]);
  assert.equal(result.usdg.token, manifest.assetDescriptors.USDG.token);
  assert.equal(result.activationPending, false);
});

test('rejects a legacy descriptor manifest or incomplete Chainlink stock set', () => {
  const manifest = { chainId: 4663, assetIds: [b32('a1'), b32('a2'), b32('a3'), b32('a4')] };
  const adapters = { chainId: 4663, assets: {} };
  assert.throws(() => buildPQMainnetAssetQueue({ manifest, adapters }), /sourceMode/);
  assert.throws(() => buildPQMainnetAssetQueue({
    manifest: {
      ...manifest,
      sourceMode: 'existing-onchain-chainlink',
      assetDescriptors: { USDG: { descriptorId: b32('a4'), token: '0x0000000000000000000000000000000000000099' } },
    },
    adapters,
  }), /complete AAPL, NVDA, and TSLA/);
});

test('blocks writes against a simulated or unverified PQ deployment manifest', () => {
  assert.throws(() => assertPQManifestBroadcastable({ status: 'SIMULATED_NOT_DEPLOYED' }, true), /not verified live/);
  assert.throws(() => assertPQManifestBroadcastable({ status: 'BROADCASTED' }, true), /not verified live/);
  assert.doesNotThrow(() => assertPQManifestBroadcastable({ status: 'SIMULATED_NOT_DEPLOYED' }, false));
  assert.doesNotThrow(() => assertPQManifestBroadcastable({ status: 'BROADCASTED_AND_LIVE_CODE_VERIFIED' }, true));
});

