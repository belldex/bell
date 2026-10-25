import { discoverV11EquityPhases } from './catalog.mjs';
import { fetchPublicDiscovery } from './fetch-catalog.mjs';
import { fileURLToPath } from 'node:url';

export async function collectPublicCatalog({
  networkType,
  assets = ['AAPL', 'NVDA', 'TSLA'],
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
} = {}) {
  const snapshot = await fetchPublicDiscovery({ networkType, assets, fetchImpl, cryptoImpl });
  const catalog = discoverV11EquityPhases(snapshot.payload, assets, networkType);
  return Object.freeze({
    retrievedAt: snapshot.retrievedAt,
    sourceUrl: snapshot.sourceUrl,
    rawResponseSha256: snapshot.sha256,
    catalog,
    sourceEntitlement: 'NOT_VERIFIED',
    admission: 'NOT_ADMITTED',
    blockers: Object.freeze([
      'authenticatedSourceEntitlement',
      'authenticatedCommonBlockIdentityReads',
      'verifiedSampleReportsPerPhase',
      'dataRightsMatrix',
      ...(!catalog.complete ? ['requiredPhaseCoverage'] : []),
    ]),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const networkType = process.argv[2];
  try {
    const result = await collectPublicCatalog({ networkType });
    console.log(JSON.stringify(result, null, 2));
    if (!result.catalog.complete) process.exitCode = 2;
  } catch (error) {
    console.error(`Public source catalog preflight failed: ${error.message}`);
    process.exitCode = 2;
  }
}
