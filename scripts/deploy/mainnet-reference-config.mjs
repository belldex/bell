const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = '0x0000000000000000000000000000000000000000';

function validAddress(value, name) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || value.toLowerCase() === ZERO) {
    throw new TypeError(`${name} must be a nonzero EVM address`);
  }
  return value.toLowerCase();
}

function validateFeed(feed, name) {
  if (!feed || typeof feed !== 'object') throw new TypeError(`${name} feed metadata is required`);
  if (!Number.isSafeInteger(feed.decimals) || feed.decimals < 0 || feed.decimals > 18) {
    throw new RangeError(`${name}.decimals must be in [0,18]`);
  }
  if (!Number.isSafeInteger(feed.heartbeatSeconds) || feed.heartbeatSeconds <= 0) {
    throw new RangeError(`${name}.heartbeatSeconds must be a positive integer`);
  }
  return Object.freeze({
    feed: validAddress(feed.proxy, `${name}.proxy`),
    decimals: feed.decimals,
    heartbeatSeconds: feed.heartbeatSeconds,
  });
}

/** Resolve all independent Chainlink feed references needed for the documented pair matrix. */
export function buildMainnetReferenceSpecs({ candidates, quoteFeeds, weth, usdg } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new TypeError('candidates must be a nonempty array');
  const symbols = new Set();
  const stocks = candidates.map((candidate) => {
    if (!candidate || typeof candidate.symbol !== 'string' || !/^[A-Z][A-Z0-9.^=-]{0,15}$/.test(candidate.symbol)) {
      throw new TypeError('candidate symbol is invalid');
    }
    if (symbols.has(candidate.symbol)) throw new Error(`duplicate symbol ${candidate.symbol}`);
    symbols.add(candidate.symbol);
    return Object.freeze({
      symbol: candidate.symbol,
      stockToken: validAddress(candidate.token, `${candidate.symbol}.token`),
      ...validateFeed(candidate.directAdjustedTokenUsd, `${candidate.symbol}.directAdjustedTokenUsd`),
    });
  });
  if (!quoteFeeds?.ETH_USD || !quoteFeeds?.USDG_USD) throw new Error('ETH_USD and USDG_USD quote feeds are required');
  return Object.freeze({
    stocks: Object.freeze(stocks),
    counterassets: Object.freeze({
      WETH: Object.freeze({ token: validAddress(weth, 'weth'), stockToken: ZERO, ...validateFeed(quoteFeeds.ETH_USD, 'ETH_USD') }),
      USDG: Object.freeze({ token: validAddress(usdg, 'usdg'), stockToken: ZERO, ...validateFeed(quoteFeeds.USDG_USD, 'USDG_USD') }),
    }),
  });
}

/** Normalize deployed evidence (`feeds`) to the lookup shape consumed by pool creation. */
export function buildReferenceAdapterMap(feeds) {
  if (!feeds || typeof feeds !== 'object' || Array.isArray(feeds)) throw new TypeError('reference feeds evidence must be an object');
  const adapters = {};
  for (const [symbol, entry] of Object.entries(feeds)) {
    if (!symbol.endsWith('/USD')) throw new Error(`reference key ${symbol} must end with /USD`);
    if (typeof entry?.sourceConfigHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(entry.sourceConfigHash)) {
      throw new TypeError(`${symbol}.sourceConfigHash must be bytes32`);
    }
    adapters[symbol] = Object.freeze({
      adapter: validAddress(entry?.adapter, `${symbol}.adapter`),
      feed: validAddress(entry?.feed, `${symbol}.feed`),
      sourceConfigHash: entry?.sourceConfigHash,
    });
  }
  return Object.freeze(adapters);
}
