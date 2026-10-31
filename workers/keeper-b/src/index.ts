/**
 * BELL keeper Worker.
 *
 * Mainnet calendar maintenance is boundary-triggered. Stock prices are read from Chainlink
 * AggregatorV3 onchain by SessionRegistry; this Worker does not publish routine price updates.
 *
 * A closed market or a stale quote is a normal state: the tick records why it skipped and the
 * alarm keeps running. Hard failures are recorded in the Durable Object so they are visible from
 * /status instead of dying silently with the process.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  stringToHex,
  toHex,
  toEventSelector,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { signYahooSourceSample } from '@bell/protocol/yahoo-attestation';
import { hashCalendarLeaf } from '@bell/protocol/calendar';
import { encodeOraclePullUpdates } from '@bell/protocol/swap-codec';
import { fetchYahooChartQuote } from '@bell/protocol/yahoo-quote';
import { evaluateQuote, isCloseCaptureWindow, isScheduledMaintenanceWindow, phaseNameForCalendarPhase, reportValidUntil, wireForCalendarPhase, ZERO32 } from './tick-policy.mjs';
import { runChainlinkStatus } from './chainlink-status.mjs';
import { buildCalendarActivation } from './calendar-maintenance.mjs';
import { KeeperState, nextAlarmTimestamp } from './keeper-state.mjs';

export { KeeperState };

const CALENDAR_ABI = parseAbi([
  'function currentInterval(bytes32) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
  'function nextInterval(bytes32) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
  'function activateInterval(bytes32,(bytes32,uint16,uint32,uint64,uint64,uint8,bytes32),(bytes32,uint16,uint32,uint64,uint64,uint8,bytes32),(bytes32,uint16,uint32,uint64,uint64,uint8,bytes32),bytes32[][])',
]);
const SESSION_ABI = parseAbi([
  'function latestSample(bytes32,uint8) view returns ((bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash))',
  'function submitReports(bytes32,bytes[])',
  'function refreshHealth(bytes32) returns (uint256)',
  'function captureClose(bytes32,bytes32) returns ((bytes32 assetId,bytes32 boundaryHash,uint128 price18,uint128 multiplier18,uint64 capturedAt,uint64 observedAt,uint64 inputAt,uint64 closureStart,bytes32 sourceHash))',
  'function health(bytes32) view returns ((bool ready,uint256 reasonBits,uint64 healthySince,uint64 validUntil,uint64 baselineObservation,uint64 latestObservation))',
  'function anchorStatus(bytes32,bytes32) view returns ((bytes32 assetId,bytes32 boundaryHash,uint128 price18,uint128 multiplier18,uint64 capturedAt,uint64 observedAt,uint64 inputAt,uint64 closureStart,bytes32 sourceHash),bool valid,uint256 reasons,uint64 validUntil)',
  'function applyPoolOracleUpdates(bytes32,bytes32,bytes,bool)',
]);
const DIRECT_ABI = parseAbi([
  'error BadSample()',
  'function readCurrent() view returns ((bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash))',
  'function publishDirect((bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash),bytes)',
]);
const HOOK_ABI = parseAbi([
  'function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
]);
const POOL_CREATED_EVENT = parseAbiItem('event PoolCreated(address indexed hook,bytes32 indexed poolId,bytes32 configHash,address indexed creator,address recipient)');
const POOL_CONFIG_ABI = parseAbi(['function config() view returns ((address token0,address token1,bytes32 asset0,bytes32 asset1,address poolManager,address positionManager,address factory,address assetRegistry,address calendarRegistry,address safetyController,address treasuryAdapter,uint8 poolClass,uint8 liquidityMode,uint8 referenceMode,int24 tickSpacing,uint128[2] tradeCap,uint128[2] windowCap,uint128[2] closureCap,bytes32 policyId,address referenceAdapter0,address referenceAdapter1))']);
const POOL_POLICY_ABI = parseAbi(['function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] effectiveTradeCap,uint128[2] effectiveWindowCap,uint128[2] rollingRemaining,uint128[2] closureRemaining,uint128[2] referencePrice18,uint64 validUntil,uint64 closureNonce,bytes32 configHash,bytes32 stateHash))']);
const POOL_STATE_ABI = parseAbi(['function state() view returns ((uint8 lifecycle,uint8 mode,bool closedLatched,uint64 closureNonce,uint64 reopenCandidateAt,uint64 oldValidUntil,uint64[2] reopenBaseObservations,uint64[2] lastOpenObservations,uint64 pauseNonce,uint64 bellStart,uint64 corporateUntil))']);
const TOKEN_ABI = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function quoteError(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

/** Read and sign only. The caller submits the bundle for onchain validation. */
export async function runQuote(env, symbol, { nowSeconds = Math.floor(Date.now() / 1000), fetchQuote = fetchYahooChartQuote } = {}) {
  if (!['AAPL', 'NVDA', 'TSLA'].includes(symbol)) throw quoteError('unsupported symbol', 400);
  if (env.BELL_ORACLE_MODE === 'chainlink') throw quoteError('stock prices are read from onchain Chainlink feeds; Worker-signed quote endpoint is disabled', 410);
  const assets = JSON.parse(env.BELL_STOCK_ASSETS || '[]');
  const asset = assets.find((entry) => entry.symbol === symbol);
  if (!asset) throw quoteError('symbol is not configured', 400);
  const adapters = JSON.parse(env.BELL_MAINNET_ASSETS || '{}')[symbol];
  const rpcUrl = env.BELL_RPC_URL || env.RH_TESTNET_RPC_PRIMARY;
  if (!rpcUrl || !env.YAHOO_REPORTER_PRIVATE_KEY || !env.BELL_CALENDAR_REGISTRY
    || !env.BELL_SESSION_REGISTRY || !env.YAHOO_SOURCE_VERIFIER_ADDRESS
    || !adapters?.directAdapter || !adapters.directWireHash) throw quoteError('quote service is not configured', 503);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  const expectedChainId = Number(env.BELL_EXPECTED_CHAIN_ID || 46630);
  if (chainId !== expectedChainId) throw quoteError(`wrong chain ${chainId}, expected ${expectedChainId}`, 503);
  const [interval, upcoming] = await Promise.all([
    publicClient.readContract({ address: env.BELL_CALENDAR_REGISTRY, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [asset.assetId] }),
    publicClient.readContract({ address: env.BELL_CALENDAR_REGISTRY, abi: CALENDAR_ABI, functionName: 'nextInterval', args: [asset.assetId] }),
  ]);
  const calendarPhase = Number(interval.phase);
  if (!phaseNameForCalendarPhase(calendarPhase)) throw quoteError(`calendar phase ${calendarPhase} has no Yahoo source`);
  if (BigInt(nowSeconds) < interval.start || BigInt(nowSeconds) >= interval.end) throw quoteError('calendar interval is not current');
  const stream = wireForCalendarPhase(adapters, calendarPhase);
  if (!stream?.wire?.feedId || !stream.wireHash) throw quoteError(`no admitted wire for phase ${calendarPhase}`);
  let quote;
  try { quote = await fetchQuote(symbol, { nowSeconds }); } catch (error) {
    console.error('Yahoo quote upstream failed', String(error?.message ?? error).slice(0, 160));
    throw quoteError('quote unavailable', 503);
  }
  if (quote?.symbol !== symbol) throw quoteError('Yahoo symbol mismatch');
  const admission = evaluateQuote({ calendarPhase, quote, nowSeconds });
  if (!admission.ok) throw quoteError(admission.reason);
  const observedAt = BigInt(quote.observedAt);
  const price18 = BigInt(quote.priceRaw18);
  if (price18 <= 0n || price18 >= 2n ** 128n) throw quoteError('invalid quote price');
  const [direct, latest] = await Promise.all([
    publicClient.readContract({ address: adapters.directAdapter, abi: DIRECT_ABI, functionName: 'readCurrent' }).catch((error) => {
      // An empty direct adapter explicitly reverts BadSample(). Never hide RPC or other errors.
      const reverted = error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : null;
      if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === 'BadSample') return { observedAt: 0n };
      throw error;
    }),
    publicClient.readContract({ address: env.BELL_SESSION_REGISTRY, abi: SESSION_ABI, functionName: 'latestSample', args: [asset.assetId, calendarPhase] }),
  ]);
  if (observedAt <= direct.observedAt || observedAt <= latest.observedAt) throw quoteError('quote observation has already been consumed', 409);
  const base = {
    descriptorId: ZERO32, price18, observedAt, inputAt: BigInt(nowSeconds), validFrom: observedAt,
    expiresAt: BigInt(nowSeconds + 300), validUntil: BigInt(reportValidUntil(nowSeconds, Number(observedAt))),
  };
  const directSample = { ...base, feedId: ZERO32, phase: 0,
    reportHash: keccak256(stringToHex(`bell-direct-${symbol}-${nowSeconds}-${quote.observedAt}-${quote.priceRaw18}`)) };
  const streamSample = { ...base, feedId: stream.wire.feedId, phase: calendarPhase,
    reportHash: keccak256(stringToHex(`bell-stream-${symbol}-${nowSeconds}-${quote.observedAt}-${quote.priceRaw18}`)) };
  const signing = { chainId, verifier: env.YAHOO_SOURCE_VERIFIER_ADDRESS, privateKey: env.YAHOO_REPORTER_PRIVATE_KEY };
  const [signedDirect, signedStream] = await Promise.all([
    signYahooSourceSample(directSample, { ...signing, sourceConfigHash: adapters.directWireHash }),
    signYahooSourceSample(streamSample, { ...signing, sourceConfigHash: stream.wireHash }),
  ]);
  const closeBoundaryHash = isCloseCaptureWindow(interval, upcoming, nowSeconds)
    ? hashCalendarLeaf({
      chainId, calendarRegistry: env.BELL_CALENDAR_REGISTRY, assetId: asset.assetId,
      year: Number(upcoming.year), index: Number(upcoming.index), start: upcoming.start,
      end: upcoming.end, phase: Number(upcoming.phase), provenanceHash: upcoming.provenanceHash,
    })
    : ZERO32;
  return {
    assetId: asset.assetId,
    directSample: Object.fromEntries(Object.entries(directSample).map(([name, value]) => [name, typeof value === 'bigint' || typeof value === 'number' ? String(value) : value])),
    directSignature: signedDirect.signature, reports: [signedStream.report], closeBoundaryHash,
  };
}

/**
 * Low-frequency, session-bound Mainnet maintenance. Calendar intervals are advanced only when
 * their previous interval expires; in Chainlink mode the Worker asks SessionRegistry to capture
 * a close directly from the onchain feed during the five-minute boundary window.
 */
export async function runScheduledMaintenance(env, { nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!isScheduledMaintenanceWindow(nowSeconds)) return { status: 'skipped', reason: 'outside a US market session boundary window' };
  const txKey = env.BELL_TRANSACTION_PRIVATE_KEY;
  const calendarRegistry = env.BELL_CALENDAR_REGISTRY;
  const sessionRegistry = env.BELL_SESSION_REGISTRY;
  const counterAssetId = env.BELL_CALENDAR_COUNTER_ASSET_ID;
  const chainlinkMode = env.BELL_ORACLE_MODE === 'chainlink';
  const rootConfigs = JSON.parse(env.BELL_CALENDAR_ROOTS || '{}');
  const assets = JSON.parse(env.BELL_STOCK_ASSETS || '[]');
  if (!txKey || !calendarRegistry || !sessionRegistry || (!counterAssetId && !chainlinkMode) || assets.length === 0) {
    return { status: 'skipped', reason: 'calendar maintenance is not fully configured' };
  }
  const expectedChainId = Number(env.BELL_EXPECTED_CHAIN_ID || 4663);
  const rpcUrl = env.BELL_RPC_URL || env.RH_MAINNET_RPC_PRIMARY || env.RH_TESTNET_RPC_PRIMARY;
  if (!rpcUrl) return { status: 'skipped', reason: 'Mainnet RPC is not configured' };
  const account = privateKeyToAccount(txKey);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (chainId !== expectedChainId) return { status: 'failed', reason: `wrong chain ${chainId}, expected ${expectedChainId}` };

  const results = {};
  for (const { symbol, assetId } of assets) {
    try {
      const rootConfig = rootConfigs[symbol];
      if (!rootConfig) { results[symbol] = { status: 'skipped', reason: 'no published calendar root is configured' }; continue; }
      let current = await publicClient.readContract({ address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [assetId] });
      if (Number(current.phase) === 0) {
        const activation = buildCalendarActivation({ config: rootConfig, chainId, calendarRegistry, assetId, nowSeconds });
        const request = await publicClient.simulateContract({
          address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'activateInterval',
          args: [assetId, activation.current, activation.previous, activation.next, activation.proofs], account,
        });
        const hash = await walletClient.writeContract(request.request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') throw new Error(`calendar activation reverted (${hash})`);
        current = await publicClient.readContract({ address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [assetId] });
        results[symbol] = { status: 'calendar-activated', phase: Number(current.phase), txHash: hash };
      } else {
        results[symbol] = { status: 'calendar-current', phase: Number(current.phase) };
      }

      const upcoming = await publicClient.readContract({ address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'nextInterval', args: [assetId] });
      if (!isCloseCaptureWindow(current, upcoming, nowSeconds)) continue;
      const boundaryHash = hashCalendarLeaf({
        chainId, calendarRegistry, assetId, year: Number(upcoming.year), index: Number(upcoming.index),
        start: upcoming.start, end: upcoming.end, phase: Number(upcoming.phase), provenanceHash: upcoming.provenanceHash,
      });
      const [, anchorValid] = await publicClient.readContract({ address: sessionRegistry, abi: SESSION_ABI, functionName: 'anchorStatus', args: [assetId, boundaryHash] });
      if (anchorValid) { results[symbol] = { ...results[symbol], anchor: 'already-valid' }; continue; }
      let request;
      if (chainlinkMode) {
        request = await publicClient.simulateContract({
          address: sessionRegistry, abi: SESSION_ABI, functionName: 'captureClose', args: [assetId, boundaryHash], account,
        });
      } else {
        const bundle = await runQuote(env, symbol, { nowSeconds });
        if (bundle.closeBoundaryHash.toLowerCase() !== boundaryHash.toLowerCase()) {
          results[symbol] = { ...results[symbol], anchor: 'skipped', reason: 'quote bundle did not match the upcoming calendar boundary' };
          continue;
        }
        const payload = encodeOraclePullUpdates([bundle]);
        request = await publicClient.simulateContract({
          address: sessionRegistry, abi: SESSION_ABI, functionName: 'applyPoolOracleUpdates',
          args: [assetId, counterAssetId, payload, false], account,
        });
      }
      const hash = await walletClient.writeContract(request.request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`close capture reverted (${hash})`);
      results[symbol] = { ...results[symbol], anchor: 'captured', source: chainlinkMode ? 'onchain-chainlink-feed' : 'signed-yahoo', txHash: hash };
    } catch (error) {
      results[symbol] = {
        status: 'failed', reason: String(error?.shortMessage ?? error?.message ?? error)
          .replace(/https?:\/\/[^\s"'`]+/g, '[url]').slice(0, 220),
      };
    }
  }
  const values = Object.values(results);
  return { status: values.some((result: any) => result.status === 'failed') ? 'partial' : 'ok', assets: results };
}

/** Public read-only directory for pools emitted by the deployed Mainnet factory. */
export async function runPools(env, { client, fetchImpl = fetch } = {}) {
  const factory = env.BELL_POOL_FACTORY;
  // Some endpoints serve eth_call but reject eth_getLogs. Prefer the Mainnet secondary/archive
  // endpoint for event discovery, then use the configured primary as a fallback.
  const rpcUrl = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_ARCHIVE_RPC
    || env.BELL_RPC_URL || env.RH_TESTNET_RPC_PRIMARY;
  if (!factory || !rpcUrl) throw quoteError('pool directory is not configured', 503);
  const chain = client ?? createPublicClient({ transport: http(rpcUrl) });
  const chainId = await chain.getChainId();
  const expectedChainId = Number(env.BELL_EXPECTED_CHAIN_ID || 46630);
  if (chainId !== expectedChainId) throw quoteError(`wrong chain ${chainId}, expected ${expectedChainId}`, 503);
  const fromBlock = BigInt(env.BELL_POOL_SCAN_FROM_BLOCK || '101800000');
  const blockNumber = await chain.getBlockNumber();
  let logs;
  try {
    // Raw eth_getLogs avoids provider-specific event-filter encoding quirks while still asking
    // the configured chain RPC for canonical event data. Use bounded parallel ranges to keep
    // the public directory response fast without exceeding the provider's per-query log limit.
    const ranges: Array<[bigint, bigint]> = [];
    for (let start = fromBlock; start <= blockNumber; start += 20_000n) {
      ranges.push([start, start + 19_999n < blockNumber ? start + 19_999n : blockNumber]);
    }
    const chunks = await Promise.all(ranges.map(([start, end]) => chain.request({ method: 'eth_getLogs', params: [{
      address: factory, fromBlock: toHex(start), toBlock: toHex(end), topics: [toEventSelector(POOL_CREATED_EVENT)],
    }] } as any)));
    logs = chunks.flatMap((chunk) => {
      if (!Array.isArray(chunk)) throw new Error('eth_getLogs returned a malformed result');
      return chunk;
    });
  } catch (rpcError) {
    const rpcDetail = String(rpcError?.shortMessage ?? rpcError?.message ?? rpcError)
      .replace(/https?:\/\/[^\s"'`]+/g, '[url]').slice(0, 180);
    console.error('factory eth_getLogs failed', rpcError?.name ?? 'Error', rpcDetail);
    // Explorer fallback is read-only and still verifies every discovered hook against the RPC.
    const legacy = new URL('https://robinhoodchain.blockscout.com/api');
    legacy.search = new URLSearchParams({ module: 'logs', action: 'getLogs', fromBlock: String(fromBlock), toBlock: 'latest', address: factory }).toString();
    // Blockscout rejects custom User-Agent strings on this public compatibility API.
    const response = await fetchImpl(legacy, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw quoteError(`pool index unavailable after RPC log read (${rpcDetail}): ${response.status}`, 503);
    const page = await response.json();
    if (!Array.isArray(page?.result)) throw quoteError(`pool logs unavailable (${String(rpcError?.shortMessage ?? rpcError?.message ?? 'RPC error').slice(0, 120)})`, 503);
    logs = page.result;
  }
  if (!Array.isArray(logs)) throw quoteError('chain RPC returned malformed factory logs', 503);
  const found = new Map<string, any>();
  for (const log of logs) {
    if (BigInt(log.blockNumber) < fromBlock) continue;
    try {
      const decoded = decodeEventLog({ abi: [POOL_CREATED_EVENT], data: log.data, topics: log.topics });
      const hook = decoded.args.hook;
      if (hook) found.set(String(hook).toLowerCase(), { args: decoded.args, blockNumber: BigInt(log.blockNumber) });
    } catch { /* Ignore unrelated factory events; only PoolCreated rows are surfaced. */ }
  }
  const unique = [...found.values()];
  const pools = await Promise.all(unique.map(async (log) => {
    const hook = log.args.hook;
    const config = await chain.readContract({ address: hook, abi: POOL_CONFIG_ABI, functionName: 'config' });
    const [policy, state, symbol0, symbol1, decimals0, decimals1] = await Promise.all([
      chain.readContract({ address: hook, abi: POOL_POLICY_ABI, functionName: 'getPolicy' }),
      chain.readContract({ address: hook, abi: POOL_STATE_ABI, functionName: 'state' }),
      chain.readContract({ address: config.token0, abi: TOKEN_ABI, functionName: 'symbol' }),
      chain.readContract({ address: config.token1, abi: TOKEN_ABI, functionName: 'symbol' }),
      chain.readContract({ address: config.token0, abi: TOKEN_ABI, functionName: 'decimals' }),
      chain.readContract({ address: config.token1, abi: TOKEN_ABI, functionName: 'decimals' }),
    ]);
    const strings = (values) => Array.from(values, (value) => String(value));
    return {
      hook, poolId: log.args.poolId, lifecycle: Number(state.lifecycle), token0: config.token0, token1: config.token1,
      asset0: config.asset0, asset1: config.asset1, configHash: policy.configHash,
      poolClass: Number(config.poolClass), liquidityMode: Number(config.liquidityMode), tickSpacing: Number(config.tickSpacing),
      tradeCap: strings(config.tradeCap), windowCap: strings(config.windowCap),
      policy: {
        canSwap: policy.canSwap, mode: Number(policy.mode), phase: Number(policy.phase), flags: Number(policy.flags),
        reasonBits: String(policy.reasonBits), lpFeeUnits: Number(policy.lpFeeUnits), bandBps: Number(policy.bandBps),
        effectiveTradeCap: strings(policy.effectiveTradeCap), effectiveWindowCap: strings(policy.effectiveWindowCap),
        rollingRemaining: strings(policy.rollingRemaining), closureRemaining: strings(policy.closureRemaining),
        referencePrice18: strings(policy.referencePrice18), validUntil: String(policy.validUntil), closureNonce: String(policy.closureNonce),
      },
      legs: [{ address: config.token0, symbol: symbol0, decimals: Number(decimals0) }, { address: config.token1, symbol: symbol1, decimals: Number(decimals1) }],
      createdAtBlock: String(log.blockNumber),
    };
  }));
  return { chainId, blockNumber: String(blockNumber), pools };
}

/** Candidate PositionManager NFTs transferred to an owner since the deployment block. */
export async function runPositionCandidates(env, owner, { client } = {}) {
  if (!/^0x[0-9a-f]{40}$/i.test(owner) || /^0x0{40}$/i.test(owner)) throw quoteError('invalid owner address', 400);
  const rpcUrl = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_ARCHIVE_RPC || env.BELL_RPC_URL || env.RH_TESTNET_RPC_PRIMARY;
  const manager = env.BELL_POSITION_MANAGER;
  if (!rpcUrl || !manager) throw quoteError('position directory is not configured', 503);
  const chain = client ?? createPublicClient({ transport: http(rpcUrl) });
  const expectedChainId = Number(env.BELL_EXPECTED_CHAIN_ID || 4663);
  if (await chain.getChainId() !== expectedChainId) throw quoteError('wrong chain for position directory', 503);
  const latest = await chain.getBlockNumber();
  const start = BigInt(env.BELL_POOL_SCAN_FROM_BLOCK || '101800000');
  const ownerTopic = `0x${owner.slice(2).toLowerCase().padStart(64, '0')}`;
  const selector = toEventSelector(parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'));
  const ranges: Array<[bigint, bigint]> = [];
  for (let from = start; from <= latest; from += 20_000n) ranges.push([from, from + 19_999n < latest ? from + 19_999n : latest]);
  const chunks = await Promise.all(ranges.map(([fromBlock, toBlock]) => chain.request({ method: 'eth_getLogs', params: [{
    address: manager, fromBlock: toHex(fromBlock), toBlock: toHex(toBlock), topics: [selector, null, ownerTopic],
  }] } as any)));
  const candidates = new Set<string>();
  for (const chunk of chunks) for (const log of Array.isArray(chunk) ? chunk : []) {
    if (log.topics?.[3]) candidates.add(BigInt(log.topics[3]).toString());
  }
  return { chainId: expectedChainId, owner: owner.toLowerCase(), blockNumber: latest.toString(), tokenIds: [...candidates] };
}

/** Runs one keeper tick. Exported so it can be exercised without Cloudflare bindings. */
export async function runTick(env, { nowSeconds = Math.floor(Date.now() / 1000), fetchQuote = fetchYahooChartQuote } = {}) {
  if (env.BELL_ORACLE_MODE === 'pull') return { status: 'skipped', reason: 'scheduled transactions disabled in pull mode' };
  // The RPC is configuration, not a testnet assumption. BELL_RPC_URL wins; the testnet variable is
  // kept as a fallback so an existing deployment keeps working unchanged.
  const rpcUrl = env.BELL_RPC_URL || env.RH_TESTNET_RPC_PRIMARY;
  if (!rpcUrl) return { status: 'skipped', reason: 'BELL_RPC_URL is not configured' };
  if (!env.YAHOO_REPORTER_PRIVATE_KEY) return { status: 'skipped', reason: 'YAHOO_REPORTER_PRIVATE_KEY is not configured' };
  const expectedChainId = Number(env.BELL_EXPECTED_CHAIN_ID || 46630);
  const transactionPrivateKey = env.BELL_TRANSACTION_PRIVATE_KEY
    || (expectedChainId === 46630 ? env.YAHOO_REPORTER_PRIVATE_KEY : null);
  if (!transactionPrivateKey) {
    return { status: 'skipped', reason: 'BELL_TRANSACTION_PRIVATE_KEY is required for sponsored mainnet transactions' };
  }

  // Multi-asset: the keeper publishes for every configured asset each tick. BELL_STOCK_ASSETS is
  // a JSON array of {symbol, assetId}; BELL_MAINNET_ASSETS is a JSON map symbol -> adapters.
  // BELL_STOCK_ASSET_ID + flat BELL_*_ADAPTER vars remain supported as a single-asset fallback.
  const assetList = env.BELL_STOCK_ASSETS
    ? (() => {
      const parsed = JSON.parse(env.BELL_STOCK_ASSETS);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('BELL_STOCK_ASSETS must be a non-empty JSON array');
      for (const a of parsed) {
        if (!a?.symbol || !/^0x[0-9a-fA-F]{64}$/.test(a.assetId ?? '')) {
          throw new Error(`BELL_STOCK_ASSETS entry invalid: ${JSON.stringify(a)}`);
        }
      }
      return parsed;
    })()
    : (env.BELL_STOCK_ASSET_ID ? [{ symbol: 'ASSET', assetId: env.BELL_STOCK_ASSET_ID }] : []);
  if (assetList.length === 0) return { status: 'skipped', reason: 'no assets configured (BELL_STOCK_ASSETS or BELL_STOCK_ASSET_ID)' };

  const calendarRegistry = env.BELL_CALENDAR_REGISTRY;
  const sessionRegistry = env.BELL_SESSION_REGISTRY;
  const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS;
  const flatAdapters = env.BELL_MAINNET_ASSETS
    ? JSON.parse(env.BELL_MAINNET_ASSETS)
    : (env.BELL_DIRECT_ADAPTER ? {
      ASSET: {
        directAdapter: env.BELL_DIRECT_ADAPTER,
        directWireHash: env.BELL_DIRECT_WIRE_HASH,
        regularWire: env.BELL_REGULAR_FEED_ID ? { feedId: env.BELL_REGULAR_FEED_ID } : null,
        regularWireHash: env.BELL_REGULAR_WIRE_HASH || null,
        extendedWire: env.BELL_EXTENDED_FEED_ID ? { feedId: env.BELL_EXTENDED_FEED_ID } : null,
        extendedWireHash: env.BELL_EXTENDED_WIRE_HASH || null,
      },
    } : {});
  if (!calendarRegistry || !sessionRegistry || !verifier || Object.keys(flatAdapters).length === 0) {
    return { status: 'skipped', reason: 'keeper addresses are not configured' };
  }

  // The reporter key signs Yahoo attestations; a separately funded relayer pays transaction gas.
  // Contracts accept reporter-signed reports from any caller, so the relayer need not hold the
  // price-signing key. Keep the testnet fallback for existing rehearsal deployments only.
  const transactionAccount = privateKeyToAccount(transactionPrivateKey);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account: transactionAccount, transport: http(rpcUrl) });

  const chainId = await publicClient.getChainId();
  // The keeper used to hardcode testnet 46630, which made a mainnet deployment unpublishable no
  // matter what the vars said. The expected chain is configuration now.
  if (chainId !== expectedChainId) {
    return { status: 'failed', reason: `wrong chain ${chainId}, expected ${expectedChainId}` };
  }

  // Per-asset loop: one failed asset is recorded and never aborts the others.
  const results = {};
  const publishedSymbols = [];
  for (const { symbol, assetId } of assetList) {
    const adapters = flatAdapters[symbol];
    try {
      if (!adapters) { results[symbol] = { status: 'skipped', reason: 'no adapter configuration for this symbol' }; continue; }
      const interval = await publicClient.readContract({
        address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [assetId],
      });
      const calendarPhase = Number(interval.phase);
      const expected = phaseNameForCalendarPhase(calendarPhase);
      if (!expected) {
        results[symbol] = { status: 'skipped', reason: `calendar phase ${calendarPhase} has no Yahoo source`, calendarPhase };
        continue;
      }
      const stream = wireForCalendarPhase(adapters, calendarPhase);
      if (!stream) { results[symbol] = { status: 'skipped', reason: `no admitted wire for phase ${calendarPhase}`, calendarPhase }; continue; }

      let quote;
      try {
        quote = await fetchQuote(symbol);
      } catch (error) {
        results[symbol] = { status: 'skipped', reason: `quote unavailable: ${error.message}`, calendarPhase };
        continue;
      }

      const admission = evaluateQuote({ calendarPhase, quote, nowSeconds });
      if (!admission.ok) {
        results[symbol] = { status: 'skipped', reason: admission.reason, calendarPhase, yahooPhase: quote.phase };
        continue;
      }

      const observedAt = BigInt(quote.observedAt);
      const price18 = BigInt(quote.priceRaw18);
      const validUntil = BigInt(reportValidUntil(nowSeconds, Number(observedAt)));
      const inputAt = BigInt(nowSeconds);

      const sampleDirect = {
        descriptorId: ZERO32, feedId: ZERO32, phase: 0, price18, observedAt,
        inputAt, validFrom: observedAt, expiresAt: BigInt(nowSeconds + 300), validUntil,
        reportHash: keccak256(stringToHex(`bell-direct-${symbol}-${nowSeconds}-${quote.observedAt}-${quote.priceRaw18}`)),
      };
      const signedDirect = await signYahooSourceSample(sampleDirect, {
        sourceConfigHash: adapters.directWireHash, chainId, verifier, privateKey: env.YAHOO_REPORTER_PRIVATE_KEY,
      });
      const directHash = await walletClient.writeContract({
        address: adapters.directAdapter, abi: DIRECT_ABI, functionName: 'publishDirect',
        args: [sampleDirect, signedDirect.signature],
      });
      const directReceipt = await publicClient.waitForTransactionReceipt({ hash: directHash });
      if (directReceipt.status !== 'success') { results[symbol] = { status: 'failed', reason: `publishDirect reverted: ${directHash}` }; continue; }

      const sampleStream = {
        descriptorId: ZERO32, feedId: stream.wire.feedId, phase: calendarPhase, price18, observedAt,
        inputAt, validFrom: observedAt, expiresAt: BigInt(nowSeconds + 300), validUntil,
        reportHash: keccak256(stringToHex(`bell-stream-${symbol}-${nowSeconds}-${quote.observedAt}-${quote.priceRaw18}`)),
      };
      const signedStream = await signYahooSourceSample(sampleStream, {
        sourceConfigHash: stream.wireHash, chainId, verifier, privateKey: env.YAHOO_REPORTER_PRIVATE_KEY,
      });
      const streamHash = await walletClient.writeContract({
        address: sessionRegistry, abi: SESSION_ABI, functionName: 'submitReports',
        args: [assetId, [signedStream.report]],
      });
      const streamReceipt = await publicClient.waitForTransactionReceipt({ hash: streamHash });
      if (streamReceipt.status !== 'success') { results[symbol] = { status: 'failed', reason: `submitReports reverted: ${streamHash}` }; continue; }

      const refreshHash = await walletClient.writeContract({
        address: sessionRegistry, abi: SESSION_ABI, functionName: 'refreshHealth', args: [assetId],
      });
      const refreshReceipt = await publicClient.waitForTransactionReceipt({ hash: refreshHash });
      if (refreshReceipt.status !== 'success') { results[symbol] = { status: 'failed', reason: `refreshHealth reverted: ${refreshHash}` }; continue; }

      const health = await publicClient.readContract({
        address: sessionRegistry, abi: SESSION_ABI, functionName: 'health', args: [assetId],
      });

      results[symbol] = {
        status: 'published', calendarPhase, yahooPhase: quote.phase,
        price18: price18.toString(), observedAt: Number(observedAt),
        transactionSender: transactionAccount.address,
        directTx: directHash, streamTx: streamHash, refreshTx: refreshHash,
        healthReady: health.ready, healthReasons: health.reasonBits.toString(),
      };
      publishedSymbols.push(symbol);
    } catch (error) {
      // An unexpected per-asset fault (malformed config, RPC hiccup) must not take down the tick.
      results[symbol] = { status: 'failed', reason: error.message };
    }
  }

  const published = publishedSymbols.length;
  const statuses = Object.values(results).map((r) => r.status);
  const overall = published > 0
    ? 'published'
    : statuses.some((s) => s === 'failed') ? 'failed' : 'skipped';
  return {
    status: overall,
    publishedSymbols,
    assets: results,
    publishedCount: published,
  };
}

const worker = {
  async scheduled(controller, env, ctx) {
    const nowSeconds = Math.floor(controller.scheduledTime / 1000);
    ctx.waitUntil(runScheduledMaintenance(env, { nowSeconds }).then((result) => {
      console.log('scheduled market maintenance', JSON.stringify(result));
    }).catch((error) => {
      const detail = String(error?.shortMessage ?? error?.message ?? error)
        .replace(/https?:\/\/[^\s"'`]+/g, '[url]').slice(0, 220);
      console.error('scheduled market maintenance failed', detail);
    }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const isPublicRead = ['/quote', '/pools', '/positions', '/status'].includes(url.pathname);
    const cors = (response) => {
      const headers = new Headers(response.headers);
      headers.set('access-control-allow-origin', '*');
      headers.set('access-control-allow-methods', 'GET, OPTIONS');
      headers.set('access-control-allow-headers', 'content-type');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
    if (isPublicRead && request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (url.pathname === '/pools') {
      if (request.method !== 'GET') return cors(json({ error: 'Method not allowed' }, 405));
      try { return cors(json(await runPools(env))); }
      catch (error) {
        const detail = String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/[^\s"'`]+/g, '[url]').slice(0, 240);
        console.error('pool directory failed', error?.name ?? 'Error', detail);
        return cors(json({ error: 'Live pool discovery is temporarily unavailable' }, error.status || 503));
      }
    }
    if (url.pathname === '/positions') {
      if (request.method !== 'GET') return cors(json({ error: 'Method not allowed' }, 405));
      try { return cors(json(await runPositionCandidates(env, url.searchParams.get('owner') || ''))); }
      catch (error) {
        const detail = String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/[^\s"'`]+/g, '[url]').slice(0, 200);
        console.error('position directory failed', error?.name ?? 'Error', detail);
        return cors(json({ error: error?.status === 400 ? detail : 'Live position discovery is temporarily unavailable' }, error.status || 503));
      }
    }
    if (url.pathname === '/quote') {
      if (request.method !== 'GET') return cors(json({ error: 'Method not allowed' }, 405));
      if (!['AAPL', 'NVDA', 'TSLA'].includes(url.searchParams.get('symbol'))) return cors(json({ error: 'unsupported symbol' }, 400));
      const id = env.KEEPER_DO.idFromName('bell-keeper');
      return cors(await env.KEEPER_DO.get(id).fetch(request));
    }
    if (env.BELL_ORACLE_MODE === 'pull' && ['/tick', '/ensure-alarm'].includes(url.pathname)) {
      return json({ error: 'scheduled transactions disabled in pull mode' }, 409);
    }
    if (env.BELL_TEST_MODE === '1' && url.pathname === '/__test/runtime') {
      // Shared-runtime vector: proves the same domain logic runs inside the Workers isolate.
      const [amounts, fee, calendar, identity, source, swap] = await Promise.all([
        import('@bell/domain/amounts'),
        import('@bell/domain/fee-policy'),
        import('@bell/protocol/calendar'),
        import('@bell/protocol/identity'),
        import('@bell/protocol/source-codec'),
        import('@bell/protocol/swap-codec'),
      ]);
      const vector = (await import('@bell/test-vectors/runtime-compat')).default;
      return json({
        fee: fee.bellFee(vector.fee.baseSessionFee, vector.fee.bellElapsedSeconds),
        rawAmount: amounts.parseUnits(vector.amount.display, vector.amount.decimals).toString(),
        calendarLeafHash: calendar.hashCalendarLeaf({
          ...vector.calendarLeaf,
          chainId: BigInt(vector.calendarLeaf.chainId),
          start: BigInt(vector.calendarLeaf.start),
          end: BigInt(vector.calendarLeaf.end),
        }),
        canonicalTokenId: identity.canonicalTokenId(BigInt(vector.canonicalToken.chainId), vector.canonicalToken.address),
        sourceWireEncoded: source.encodeSourceWires([vector.sourceWire]),
        swapRequestEncoded: swap.encodeSwapRequest(vector.swapRequest),
      });
    }
    if (url.pathname === '/status') {
      if (env.BELL_ORACLE_MODE === 'chainlink') {
        try { return cors(json(await runChainlinkStatus(env))); }
        catch (error) {
          const detail = String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/[^\s"'`]+/g, '[url]').slice(0, 220);
          console.error('Chainlink status read failed', error?.name ?? 'Error', detail);
          return cors(json({ error: 'Live Chainlink status is temporarily unavailable' }, 503));
        }
      }
      const id = env.KEEPER_DO.idFromName('bell-keeper');
      return env.KEEPER_DO.get(id).fetch(new Request('https://do/status'));
    }
    if (url.pathname === '/tick') {
      const id = env.KEEPER_DO.idFromName('bell-keeper');
      return env.KEEPER_DO.get(id).fetch(new Request('https://do/tick'));
    }
    if (url.pathname === '/ensure-alarm') {
      const id = env.KEEPER_DO.idFromName('bell-keeper');
      return env.KEEPER_DO.get(id).fetch(new Request('https://do/ensure-alarm'));
    }
    return new Response('Not found', { status: 404 });
  },
};

export default worker;
