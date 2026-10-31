const CHAIN_ID = 4663;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

function requireAddress(value, label) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} is missing or is not a nonzero EVM address`);
  }
  return value;
}

function requireBytes32(value, label) {
  if (typeof value !== 'string' || !BYTES32.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error(`${label} is missing or is not a nonzero bytes32`);
  }
  return value;
}

function requireChain(evidence, label) {
  if (Number(evidence?.chainId) !== CHAIN_ID) {
    throw new Error(`${label} chainId is ${evidence?.chainId ?? 'missing'}, expected ${CHAIN_ID}`);
  }
}

/** Build the live multi-asset Worker vars solely from active Mainnet evidence. */
export function buildMainnetKeeperVars({ manifest, broadcast, adapters, assets, assetState, calendarStates }) {
  requireChain(manifest, 'manifest');
  requireChain(broadcast, 'broadcast');
  requireChain(adapters, 'stock adapters');
  requireChain(assets, 'asset queue');
  requireChain(assetState, 'asset state');
  if (broadcast.status !== 'BROADCASTED_AND_LIVE_CODE_VERIFIED') {
    throw new Error('broadcast evidence is not live-code-verified on chain 4663');
  }
  if (assets.activationPending) throw new Error('asset admission is still pending');
  if (assetState.stage !== 'ACTIVE') throw new Error(`asset state is ${assetState.stage ?? 'missing'}, expected ACTIVE`);

  const symbols = Object.keys(assets.stocks ?? {}).sort();
  if (symbols.length === 0) throw new Error('asset queue has no admitted stocks');

  const stockAssets = [];
  const perAsset = {};
  for (const symbol of symbols) {
    const asset = assets.stocks[symbol];
    const activeAsset = assetState.stocks?.[symbol];
    if (asset.active === false || !activeAsset?.active) throw new Error(`${symbol} asset descriptor is not active`);
    if (asset.symbol && asset.symbol !== symbol) throw new Error(`${symbol} queue entry has mismatched symbol ${asset.symbol}`);
    if (activeAsset.descriptorId?.toLowerCase() !== asset.descriptorId?.toLowerCase()) {
      throw new Error(`${symbol} descriptor differs between queue and active-state evidence`);
    }
    requireBytes32(asset.descriptorId, `${symbol} descriptorId`);

    const source = adapters.assets?.[symbol];
    if (!source) throw new Error(`${symbol} Yahoo adapter evidence is missing`);
    if (source.stockToken?.toLowerCase() !== asset.token?.toLowerCase()) {
      throw new Error(`${symbol} Yahoo adapter token does not match the admitted token`);
    }
    requireAddress(source.directAdapter, `${symbol} directAdapter`);
    const directWireHash = requireBytes32(source.directWireHash, `${symbol} directWireHash`);
    const regularFeedId = requireBytes32(source.regularWire?.feedId, `${symbol} regular feedId`);
    const regularWireHash = requireBytes32(source.regularWireHash, `${symbol} regularWireHash`);
    const extendedFeedId = requireBytes32(source.extendedWire?.feedId, `${symbol} extended feedId`);
    const extendedWireHash = requireBytes32(source.extendedWireHash, `${symbol} extendedWireHash`);

    const calendar = calendarStates?.[symbol];
    requireChain(calendar, `${symbol} calendar`);
    if (calendar.assetLabel !== symbol || calendar.stage !== 'INTERVAL_ACTIVE') {
      throw new Error(`${symbol} calendar is not active (stage=${calendar.stage ?? 'missing'})`);
    }

    stockAssets.push({ symbol, assetId: asset.descriptorId });
    perAsset[symbol] = {
      directAdapter: source.directAdapter,
      directWireHash,
      regularWire: { feedId: regularFeedId },
      regularWireHash,
      extendedWire: { feedId: extendedFeedId },
      extendedWireHash,
    };
  }

  const verifier = requireAddress(adapters.verifier, 'Yahoo source verifier');
  return {
    BELL_ORACLE_MODE: 'pull',
    BELL_EXPECTED_CHAIN_ID: String(CHAIN_ID),
    BELL_STOCK_ASSETS: JSON.stringify(stockAssets),
    BELL_MAINNET_ASSETS: JSON.stringify(perAsset),
    BELL_CALENDAR_REGISTRY: requireAddress(manifest.calendarRegistry, 'CalendarRegistry'),
    BELL_SESSION_REGISTRY: requireAddress(manifest.sessionRegistry, 'SessionRegistry'),
    YAHOO_SOURCE_VERIFIER_ADDRESS: verifier,
  };
}

/** Build Chainlink-mode Worker vars exclusively from live deployment/admission/calendar evidence. */
export function buildMainnetChainlinkKeeperVars({ manifest, verification, adapters, assets, assetState, calendarStates }) {
  requireChain(manifest, 'manifest');
  requireChain(verification, 'verification');
  requireChain(adapters, 'Chainlink session adapters');
  requireChain(assets, 'asset queue');
  requireChain(assetState, 'asset state');
  if (assets.activationPending) throw new Error('asset admission is still pending');
  if (assetState.stage !== 'ACTIVE') throw new Error('asset state is ' + (assetState.stage ?? 'missing') + ', expected ACTIVE');
  const verifiedAtBlock = Number(verification.blocks?.verifiedAtBlock);
  if (!Number.isSafeInteger(verifiedAtBlock) || verifiedAtBlock < 1) {
    throw new Error('Mainnet verification evidence has no verifiedAtBlock');
  }
  const symbols = Object.keys(assets.stocks ?? {}).sort();
  if (symbols.length === 0) throw new Error('asset queue has no admitted stocks');
  const stockAssets = [];
  const roots = {};
  for (const symbol of symbols) {
    const asset = assets.stocks[symbol];
    const active = assetState.stocks?.[symbol];
    if (asset.active === false || !(active?.active || active?.alreadyActive)) {
      throw new Error(symbol + ' asset descriptor is not active');
    }
    if (active.descriptorId?.toLowerCase() !== asset.descriptorId?.toLowerCase()) {
      throw new Error(symbol + ' descriptor differs between queue and active-state evidence');
    }
    requireBytes32(asset.descriptorId, symbol + ' descriptorId');
    const source = adapters.assets?.[symbol];
    if (!source) throw new Error(symbol + ' Chainlink adapter evidence is missing');
    for (const key of ['directAdapter', 'regularAdapter', 'extendedAdapter', 'overnightAdapter']) {
      requireAddress(source[key], symbol + ' ' + key);
    }
    const calendar = calendarStates?.[symbol];
    requireChain(calendar, symbol + ' calendar');
    if (calendar.assetLabel !== symbol || !['ROOT_ACTIVE', 'INTERVAL_ACTIVE'].includes(calendar.stage)) {
      throw new Error(symbol + ' calendar root is not active (stage=' + (calendar.stage ?? 'missing') + ')');
    }
    const root = requireBytes32(calendar.root, symbol + ' calendar root');
    const year = Number(calendar.year);
    const coverageStart = Number(calendar.coverageStart);
    const coverageEnd = Number(calendar.coverageEnd);
    if (!Number.isInteger(year) || year < 2020 || year > 2200
      || !Number.isSafeInteger(coverageStart) || !Number.isSafeInteger(coverageEnd) || coverageStart >= coverageEnd) {
      throw new Error(symbol + ' calendar coverage is invalid');
    }
    stockAssets.push({ symbol, assetId: asset.descriptorId });
    roots[symbol] = { root, year, coverageStart, coverageEnd, capabilityMask: Number(asset.capabilityMask ?? 0b11110) };
  }
  const counterassetId = requireBytes32(assets.weth?.descriptorId, 'WETH descriptorId');
  return {
    BELL_ORACLE_MODE: 'chainlink',
    BELL_EXPECTED_CHAIN_ID: String(CHAIN_ID),
    BELL_ASSET_REGISTRY: requireAddress(manifest.assetRegistry, 'AssetRegistry'),
    BELL_POOL_FACTORY: requireAddress(manifest.poolFactory, 'PoolFactory'),
    BELL_POOL_SCAN_FROM_BLOCK: String(verifiedAtBlock),
    BELL_POSITION_MANAGER: requireAddress(manifest.positionManager, 'PositionManager'),
    BELL_STOCK_ASSETS: JSON.stringify(stockAssets),
    BELL_MAINNET_ASSETS: '{}',
    BELL_CALENDAR_REGISTRY: requireAddress(manifest.calendarRegistry, 'CalendarRegistry'),
    BELL_SESSION_REGISTRY: requireAddress(manifest.sessionRegistry, 'SessionRegistry'),
    BELL_CALENDAR_COUNTER_ASSET_ID: counterassetId,
    BELL_CALENDAR_ROOTS: JSON.stringify(roots),
  };
}

/** Replace Wrangler's vars object while respecting braces inside quoted JSON-valued strings. */
export function replaceWranglerVars(source, vars) {
  const marker = source.indexOf('"vars"');
  if (marker < 0) throw new Error('could not find the "vars" block in wrangler.jsonc');
  const openBrace = source.indexOf('{', marker);
  if (openBrace < 0) throw new Error('could not find the start of the "vars" block');

  let depth = 0;
  let quoted = false;
  let escaped = false;
  let end = -1;
  for (let i = openBrace; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('could not find the end of the "vars" block');

  const block = Object.entries(vars)
    .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(String(value))}`)
    .join(',\n');
  return `${source.slice(0, openBrace)}{\n${block}\n  }${source.slice(end + 1)}`;
}
