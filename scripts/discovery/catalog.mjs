const phaseByAttribute = Object.freeze({
  RegularHoursEquityPrice: 'REGULAR',
  ExtendedHoursEquityPrice: 'EXTENDED',
  OvernightHoursEquityPrice: 'OVERNIGHT',
});

export function discoverV11EquityPhases(payload, requiredAssets, networkType) {
  if (!payload || !Array.isArray(payload.feeds)) throw new TypeError('Discovery response must contain a feeds array');
  if (!Array.isArray(requiredAssets) || requiredAssets.length === 0
    || requiredAssets.some((asset) => typeof asset !== 'string' || !/^[A-Z0-9._-]+$/.test(asset))) {
    throw new TypeError('requiredAssets must be non-empty uppercase asset identifiers');
  }
  if (new Set(requiredAssets).size !== requiredAssets.length) throw new Error('requiredAssets must be unique');
  if (!['mainnet', 'testnet'].includes(networkType)) throw new RangeError('networkType must be mainnet or testnet');

  const required = new Set(requiredAssets);
  const idCounts = new Map();
  for (const feed of payload.feeds) {
    if (typeof feed?.feedId === 'string' && /^0x[0-9a-f]{64}$/i.test(feed.feedId)) {
      const key = feed.feedId.toLowerCase();
      idCounts.set(key, (idCounts.get(key) ?? 0) + 1);
    }
  }

  const phaseCounts = new Map();
  for (const feed of payload.feeds) {
    const asset = typeof feed?.baseAsset === 'string' ? feed.baseAsset.toUpperCase() : '';
    const phase = phaseByAttribute[feed?.attributeType];
    const validId = typeof feed?.feedId === 'string' && /^0x[0-9a-f]{64}$/i.test(feed.feedId)
      && idCounts.get(feed.feedId.toLowerCase()) === 1;
    if (required.has(asset) && phase && feed.schemaVersion === 'V11' && feed.networkType === networkType
      && feed.status === 'live' && feed.assetClass === 'Equities' && feed.feedType === 'Equities'
      && feed.quoteAsset === 'USD' && validId) {
      const key = `${asset}:${phase}`;
      phaseCounts.set(key, (phaseCounts.get(key) ?? 0) + 1);
    }
  }

  const candidates = [];
  const rejected = [];
  const seen = new Set();
  for (const feed of payload.feeds) {
    if (!feed || typeof feed !== 'object') {
      rejected.push({ reason: 'malformed-feed' });
      continue;
    }
    const asset = typeof feed.baseAsset === 'string' ? feed.baseAsset.toUpperCase() : '';
    if (!required.has(asset)) continue;
    const phase = phaseByAttribute[feed.attributeType];
    let reason = null;
    if (!phase) reason = 'unsupported-equity-phase';
    else if (feed.schemaVersion !== 'V11') reason = 'wrong-schema';
    else if (feed.networkType !== networkType) reason = 'wrong-network';
    else if (feed.status !== 'live') reason = 'not-live';
    else if (feed.assetClass !== 'Equities' || feed.feedType !== 'Equities') reason = 'wrong-feed-class';
    else if (feed.quoteAsset !== 'USD') reason = 'wrong-quote-asset';
    else if (typeof feed.feedId !== 'string' || !/^0x[0-9a-f]{64}$/i.test(feed.feedId)) reason = 'invalid-feed-id';
    else if (idCounts.get(feed.feedId.toLowerCase()) !== 1) reason = 'duplicate-feed-id';

    const key = `${asset}:${phase ?? feed.attributeType}`;
    if (!reason && phaseCounts.get(key) > 1) reason = 'duplicate-asset-phase';
    if (!reason && seen.has(key)) reason = 'duplicate-asset-phase';
    if (reason) {
      rejected.push({ asset, phase: phase ?? null, feedId: feed.feedId ?? null, reason });
      continue;
    }
    seen.add(key);
    candidates.push(Object.freeze({
      baseAsset: asset,
      quoteAsset: 'USD',
      phase,
      feedId: feed.feedId.toLowerCase(),
      schemaVersion: 11,
      status: 'live',
      networkType,
    }));
  }

  const expectedPhases = Object.values(phaseByAttribute);
  const missing = requiredAssets.flatMap((asset) => expectedPhases
    .filter((phase) => !seen.has(`${asset}:${phase}`))
    .map((phase) => ({ asset, phase })));
  return Object.freeze({
    complete: missing.length === 0,
    candidates: Object.freeze(candidates),
    rejected: Object.freeze(rejected),
    missing: Object.freeze(missing),
  });
}
