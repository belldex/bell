import { parseAbi } from 'viem';
import { encodeOraclePullUpdates, normalizeOraclePullUpdates, ORACLE_PULL_UPDATES_ABI, ZERO32 } from '../../packages/protocol/src/swap-codec.mjs';
import { hashCalendarLeaf } from '../../packages/protocol/src/calendar.mjs';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;
const STOCKS = ['AAPL', 'NVDA', 'TSLA'];
export const PREPARE_SESSION_ABI = parseAbi(['function applyPoolOracleUpdates(bytes32 asset0,bytes32 asset1,bytes payload,bool swapEnvelope)']);
export const PREPARE_HOOK_ABI = [{ name: 'prepareOracleUpdates', type: 'function', stateMutability: 'nonpayable', inputs: ORACLE_PULL_UPDATES_ABI, outputs: [] }];
export const ORACLE_POOL_CONFIG_ABI = parseAbi(['function config() view returns ((address token0,address token1,bytes32 asset0,bytes32 asset1,address poolManager,address positionManager,address factory,address assetRegistry,address calendarRegistry,address safetyController,address treasuryAdapter,uint8 poolClass,uint8 liquidityMode,uint8 referenceMode,int24 tickSpacing,uint128[2] tradeCap,uint128[2] windowCap,uint128[2] closureCap,bytes32 policyId,address referenceAdapter0,address referenceAdapter1))']);

function address(value, label) {
  if (!ADDRESS.test(value ?? '') || BigInt(value) === 0n) throw new Error(`${label} must be a nonzero EVM address`);
  return value.toLowerCase();
}

/** Resolve only evidence-bound pairs; address sorting must carry the matching descriptor IDs. */
export function resolveOraclePair({ stock, counterasset, assetQueue }) {
  if (!stock || !counterasset) throw new Error('explicit --stock and --counterasset are required');
  stock = stock.toUpperCase();
  counterasset = counterasset.toUpperCase();
  if (!STOCKS.includes(stock)) throw new Error(`unsupported stock ${stock}`);
  if (assetQueue?.activationPending) throw new Error('asset activation is pending');
  const entries = [
    [stock, assetQueue?.stocks?.[stock], true],
    [counterasset, STOCKS.includes(counterasset) ? assetQueue?.stocks?.[counterasset] : assetQueue?.[counterasset.toLowerCase()], STOCKS.includes(counterasset)],
  ];
  const legs = entries.map(([symbol, entry, isStock]) => {
    if (!entry || entry.isStock !== isStock || !BYTES32.test(entry.descriptorId ?? '') || entry.descriptorId.toLowerCase() === ZERO32) {
      throw new Error(`missing or inconsistent admitted descriptor evidence for ${symbol}`);
    }
    return { symbol, token: address(entry.token, `${symbol} token`), assetId: entry.descriptorId.toLowerCase(), isStock };
  });
  if (legs[0].token === legs[1].token || legs[0].assetId === legs[1].assetId) throw new Error('pool pair tokens and descriptors must be distinct');
  const stockSymbols = legs.filter((leg) => leg.isStock).map((leg) => leg.symbol);
  legs.sort((left, right) => left.token.localeCompare(right.token));
  return { legs, stockSymbols, token0: legs[0].token, token1: legs[1].token, asset0: legs[0].assetId, asset1: legs[1].assetId };
}

export function validateOraclePoolPair(pair, config) {
  if (!config || ['token0', 'token1', 'asset0', 'asset1'].some((key) => config[key]?.toLowerCase() !== pair[key])) {
    throw new Error('pool config does not match the selected evidence-bound pair');
  }
}

function completeUpdates(pair, updates) {
  const normalized = normalizeOraclePullUpdates(updates);
  const expected = pair.legs.filter((leg) => leg.isStock).map((leg) => leg.assetId);
  if (normalized.length !== expected.length || normalized.some((update) => !expected.includes(update.assetId))) {
    throw new Error('complete unique oracle updates are required for every stock leg of the selected pair');
  }
  return normalized;
}

/** Read signed bundles only. No credentials or transaction fields are sent to the Worker. */
export async function fetchPoolOracleUpdates({ pair, quoteUrl, fetchImpl = fetch, closeBoundaries = {} }) {
  if (!quoteUrl) throw new Error('--quote-url or BELL_QUOTE_SERVICE_URL is required');
  for (const symbol of Object.keys(closeBoundaries)) {
    if (!pair.stockSymbols.includes(symbol)) throw new Error(`close boundary supplied for non-stock leg ${symbol}`);
  }
  const updates = await Promise.all(pair.stockSymbols.map(async (symbol) => {
    const url = new URL(quoteUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('quote URL must be HTTP(S) without credentials');
    url.pathname = `${url.pathname.replace(/\/$/, '').replace(/\/quote$/, '')}/quote`;
    url.search = '';
    url.hash = '';
    url.searchParams.set('symbol', symbol);
    const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`quote service refused ${symbol}: HTTP ${response.status}`);
    const update = await response.json();
    const expected = pair.legs.find((leg) => leg.symbol === symbol).assetId;
    if (update?.assetId?.toLowerCase() !== expected) throw new Error(`quote assetId mismatch for ${symbol}`);
    // Close capture is opt-in; never accept an unsolicited boundary hash from the service.
    return { ...update, closeBoundaryHash: closeBoundaries[symbol] ?? ZERO32 };
  }));
  return completeUpdates(pair, updates);
}

export function validateCloseBoundary({ hash, assetId, leaf, chainId, calendarRegistry, now }) {
  if (!BYTES32.test(hash ?? '') || hash.toLowerCase() === ZERO32) throw new Error('explicit close boundary must be a nonzero bytes32');
  if (!leaf || leaf.assetId?.toLowerCase() !== assetId.toLowerCase() || Number(leaf.phase) !== 5) throw new Error('close boundary must identify the canonical upcoming CLOSED leaf');
  const start = BigInt(leaf.start);
  if (BigInt(now) >= start || BigInt(now) + 300n < start) throw new Error('close boundary capture requires the five-minute pre-close window');
  const canonical = hashCalendarLeaf({ ...leaf, chainId, calendarRegistry });
  if (hash.toLowerCase() !== canonical) throw new Error('close boundary hash does not match the canonical CLOSED leaf');
  return canonical;
}

export function buildOraclePreparation({ pair, updates, sessionRegistry, hook, hookConfig }) {
  const normalized = completeUpdates(pair, updates);
  if (hook) {
    validateOraclePoolPair(pair, hookConfig);
    return { address: address(hook, 'hook'), abi: PREPARE_HOOK_ABI, functionName: 'prepareOracleUpdates', args: [normalized] };
  }
  return {
    address: address(sessionRegistry, 'sessionRegistry'), abi: PREPARE_SESSION_ABI, functionName: 'applyPoolOracleUpdates',
    args: [pair.asset0, pair.asset1, encodeOraclePullUpdates(normalized), false],
  };
}

export async function executeOraclePreparation({ call, publicClient, account, broadcast = false, authorized = false, walletClient }) {
  if (broadcast && !authorized) throw new Error('broadcast blocked: explicit --i-authorize-spend is required');
  const simulation = await publicClient.simulateContract({ ...call, account });
  if (!broadcast) return { mode: 'PLAN_ONLY', simulation };
  if (!walletClient) throw new Error('authorized broadcast requires a wallet client');
  const hash = await walletClient.writeContract(simulation.request);
  return { mode: 'BROADCAST', hash };
}
