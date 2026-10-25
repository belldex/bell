const ENDPOINTS = Object.freeze({
  mainnet: 'https://api.dataengine.chain.link/api/v1/discovery',
  testnet: 'https://api.testnet-dataengine.chain.link/api/v1/discovery',
});

function validateAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0
    || assets.some((asset) => typeof asset !== 'string' || !/^[A-Z0-9._-]+$/.test(asset))) {
    throw new TypeError('assets must be non-empty uppercase asset identifiers');
  }
  if (new Set(assets).size !== assets.length) throw new Error('assets must be unique');
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fetchPublicDiscovery({ networkType, assets, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
  const endpoint = ENDPOINTS[networkType];
  if (!endpoint) throw new RangeError('networkType must be mainnet or testnet');
  validateAssets(assets);
  if (typeof fetchImpl !== 'function') throw new TypeError('authenticated metadata fetch implementation unavailable');
  if (!cryptoImpl?.subtle) throw new TypeError('WebCrypto SHA-256 is required for discovery evidence');

  const url = new URL(endpoint);
  url.searchParams.set('base_asset', assets.join(','));
  url.searchParams.set('feed_type', 'Equities');
  url.searchParams.set('status', 'live');
  url.searchParams.set('network_type', networkType);
  const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Public Discovery request failed with HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Public Discovery response was not valid JSON');
  }
  if (!payload || !Array.isArray(payload.feeds)) throw new Error('Public Discovery response is missing feeds array');
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return Object.freeze({
    sourceUrl: url.toString(),
    networkType,
    retrievedAt: new Date().toISOString(),
    sha256: toHex(new Uint8Array(digest)),
    payload,
  });
}
