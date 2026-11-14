const REQUIRED_SYMBOLS = ['AAPL', 'NVDA', 'TSLA'];
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;

export function assertPQManifestBroadcastable(manifest, broadcastRequested) {
  if (broadcastRequested && manifest?.status !== 'BROADCASTED_AND_LIVE_CODE_VERIFIED') {
    throw new Error('PQ deployment manifest is not verified live; refusing Mainnet write');
  }
}

function requireAddress(value, label) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} is not a nonzero address`);
  }
  return value;
}

function requireBytes32(value, label) {
  if (typeof value !== 'string' || !BYTES32.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error(`${label} is not a nonzero bytes32`);
  }
  return value;
}

/** Build the canonical post-genesis asset queue from the exact IDs written by the PQ deploy run. */
export function buildPQMainnetAssetQueue({ manifest, adapters }) {
  if (Number(manifest?.chainId) !== 4663) throw new Error('PQ manifest must target Robinhood Chain Mainnet (4663)');
  if (manifest?.sourceMode !== 'existing-onchain-chainlink') throw new Error('PQ manifest sourceMode is not existing-onchain-chainlink');
  if (Number(adapters?.chainId) !== 4663) throw new Error('Chainlink adapter evidence must target chain 4663');
  if (!Array.isArray(manifest.assetIds) || manifest.assetIds.length !== 4) {
    throw new Error('PQ manifest must contain the three stock IDs and the USDG ID');
  }
  manifest.assetIds.forEach((id, index) => requireBytes32(id, `PQ assetIds[${index}]`));
  const descriptorEntries = manifest.assetDescriptors;
  if (!descriptorEntries || !descriptorEntries.USDG) throw new Error('PQ manifest is missing its genesis asset token map');

  const symbols = Object.keys(adapters.assets ?? {}).sort();
  if (symbols.join(',') !== REQUIRED_SYMBOLS.join(',')) {
    throw new Error('Chainlink evidence must contain the complete AAPL, NVDA, and TSLA set');
  }
  const stocks = {};
  for (const [index, symbol] of REQUIRED_SYMBOLS.entries()) {
    const source = adapters.assets[symbol];
    const descriptor = descriptorEntries[symbol];
    if (descriptor?.descriptorId?.toLowerCase() !== manifest.assetIds[index].toLowerCase()) {
      throw new Error(`${symbol} descriptor map does not match its genesis asset ID`);
    }
    stocks[symbol] = {
      symbol,
      token: requireAddress(source.stockToken, `${symbol} token`),
      descriptorId: manifest.assetIds[index],
      isStock: true,
      directAdapter: requireAddress(source.directAdapter, `${symbol} direct adapter`),
      regularAdapter: requireAddress(source.regularAdapter, `${symbol} regular adapter`),
      extendedAdapter: requireAddress(source.extendedAdapter, `${symbol} extended adapter`),
      overnightAdapter: requireAddress(source.overnightAdapter, `${symbol} overnight adapter`),
      capabilityMask: Number(source.capabilityMask ?? 30),
    };
    if (descriptor.token?.toLowerCase() !== stocks[symbol].token.toLowerCase()) {
      throw new Error(`${symbol} token differs between the PQ manifest and Chainlink evidence`);
    }
  }

  const usdgToken = requireAddress(descriptorEntries.USDG.token, 'USDG token');
  if (descriptorEntries.USDG.descriptorId?.toLowerCase() !== manifest.assetIds[3].toLowerCase()) {
    throw new Error('USDG descriptor map does not match its genesis asset ID');
  }
  return Object.freeze({
    chainId: 4663,
    activationPending: false,
    genesisSource: 'pq-mainnet-dry-run-manifest',
    usdg: Object.freeze({
      token: usdgToken,
      descriptorId: manifest.assetIds[3],
      isStock: false,
      alreadyActive: true,
    }),
    stocks: Object.freeze(stocks),
  });
}
