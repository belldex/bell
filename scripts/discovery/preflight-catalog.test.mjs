import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPublicCatalog } from './preflight-catalog.mjs';

const attributes = ['RegularHoursEquityPrice', 'ExtendedHoursEquityPrice', 'OvernightHoursEquityPrice'];
const payload = {
  feeds: ['AAPL', 'NVDA', 'TSLA'].flatMap((baseAsset, assetIndex) => attributes.map((attributeType, phaseIndex) => ({
    baseAsset, quoteAsset: 'USD', assetClass: 'Equities', feedType: 'Equities', attributeType,
    schemaVersion: 'V11', networkType: 'mainnet', status: 'live',
    feedId: `0x${(assetIndex * 3 + phaseIndex + 1).toString(16).padStart(64, '0')}`,
  }))),
};

test('catalog preflight emits documented metadata but never infers source entitlement or admission', async () => {
  const result = await collectPublicCatalog({
    networkType: 'mainnet',
    fetchImpl: async () => Response.json(payload),
  });
  assert.equal(result.catalog.complete, true);
  assert.equal(result.catalog.candidates.length, 9);
  assert.equal(result.sourceEntitlement, 'NOT_VERIFIED');
  assert.equal(result.admission, 'NOT_ADMITTED');
});

test('catalog preflight retains missing phase information rather than reporting full coverage', async () => {
  const result = await collectPublicCatalog({
    networkType: 'mainnet',
    fetchImpl: async () => Response.json({ feeds: payload.feeds.slice(0, 2) }),
  });
  assert.equal(result.catalog.complete, false);
  assert.ok(result.catalog.missing.length > 0);
  assert.equal(result.admission, 'NOT_ADMITTED');
});
