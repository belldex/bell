import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverV11EquityPhases } from './catalog.mjs';

const phases = [
  ['RegularHoursEquityPrice', 'REGULAR'],
  ['ExtendedHoursEquityPrice', 'EXTENDED'],
  ['OvernightHoursEquityPrice', 'OVERNIGHT'],
];
const feeds = ['AAPL', 'NVDA', 'TSLA'].flatMap((asset, assetIndex) => phases.map(([attributeType], phaseIndex) => ({
  baseAsset: asset,
  quoteAsset: 'USD',
  assetClass: 'Equities',
  feedType: 'Equities',
  attributeType,
  schemaVersion: 'V11',
  networkType: 'mainnet',
  status: 'live',
  feedId: `0x${(assetIndex * 3 + phaseIndex + 1).toString(16).padStart(64, '0')}`,
})));

test('maps exactly three canonical equities to distinct v11 phase streams', () => {
  const result = discoverV11EquityPhases({ feeds }, ['AAPL', 'NVDA', 'TSLA'], 'mainnet');
  assert.equal(result.complete, true);
  assert.equal(result.candidates.length, 9);
  assert.deepEqual(result.candidates.slice(0, 3).map(({ phase }) => phase), ['REGULAR', 'EXTENDED', 'OVERNIGHT']);
});

test('does not accept v10, testnet, non-live, wrong-quote, or duplicate phase candidates', () => {
  const invalid = structuredClone(feeds);
  invalid[0].schemaVersion = 'V10';
  invalid[1].networkType = 'testnet';
  invalid[2].status = 'testing';
  invalid[3].quoteAsset = 'EUR';
  invalid[4].feedId = feeds[0].feedId;
  const result = discoverV11EquityPhases({ feeds: invalid }, ['AAPL', 'NVDA', 'TSLA'], 'mainnet');
  assert.equal(result.complete, false);
  assert.equal(result.candidates.length, 4);
  assert.ok(result.rejected.length >= 5);
});

test('fails closed on malformed catalog or missing phase coverage', () => {
  assert.throws(() => discoverV11EquityPhases({ data: [] }, ['AAPL'], 'mainnet'), /feeds/i);
  assert.equal(discoverV11EquityPhases({ feeds: feeds.slice(0, 2) }, ['AAPL'], 'mainnet').complete, false);
});

test('does not pick one arbitrarily when metadata duplicates an asset phase', () => {
  const duplicate = { ...feeds[0], feedId: `0x${'f'.repeat(64)}` };
  const result = discoverV11EquityPhases({ feeds: [...feeds, duplicate] }, ['AAPL', 'NVDA', 'TSLA'], 'mainnet');
  assert.equal(result.complete, false);
  assert.equal(result.candidates.some(({ baseAsset, phase }) => baseAsset === 'AAPL' && phase === 'REGULAR'), false);
  assert.ok(result.rejected.some(({ reason }) => reason === 'duplicate-asset-phase'));
});
