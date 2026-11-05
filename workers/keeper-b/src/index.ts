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
  encodeAbiParameters,
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
import { eligibleAuctions, auctionSettlementResult } from './auction-settlement.mjs';

export { KeeperState };

// CalendarLeaf.year is uint32 onchain (ProtocolTypes.sol:92), and every tuple component must be
// NAMED. Two separate defects lived in this one constant:
//
//   1. year was uint16, which moves the activateInterval selector so the call hit an unknown
//      function.
//   2. the tuple components were anonymous. viem then expects a positional array, while the
//      activation builder returns an object, so encoding threw
//      "Cannot read properties of undefined (reading 'length')" before any RPC call.
//
// Both were swallowed by a try/catch, so the calendar only advanced when a human ran the script.
// Exported so a test can pin the shape against the deployed registry.
export const CALENDAR_ABI = parseAbi([
  'function currentInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
  'function nextInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
  'function activateInterval(bytes32 assetId,(bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash) current,(bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash) previous,(bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash) next,bytes32[][] proofs)',
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
// Cloudflare Workers abort an invocation that exceeds 50 subrequests. Reserve headroom for the
// chain-id, block-number and per-pool reads that follow the log scan. The configured Mainnet
// secondary endpoint accepts multi-hundred-thousand block ranges, so a handful of pages covers the
// whole deployment history; the incremental cache then keeps later scans to one page.
const POOL_SCAN_MAX_PAGES = 4;
const POOL_CONFIG_ABI = parseAbi(['function config() view returns ((address token0,address token1,bytes32 asset0,bytes32 asset1,address poolManager,address positionManager,address factory,address assetRegistry,address calendarRegistry,address safetyController,address treasuryAdapter,uint8 poolClass,uint8 liquidityMode,uint8 referenceMode,int24 tickSpacing,uint128[2] tradeCap,uint128[2] windowCap,uint128[2] closureCap,bytes32 policyId,address referenceAdapter0,address referenceAdapter1))']);
const POOL_POLICY_ABI = parseAbi(['function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] effectiveTradeCap,uint128[2] effectiveWindowCap,uint128[2] rollingRemaining,uint128[2] closureRemaining,uint128[2] referencePrice18,uint64 validUntil,uint64 closureNonce,bytes32 configHash,bytes32 stateHash))']);
const POOL_STATE_ABI = parseAbi(['function state() view returns ((uint8 lifecycle,uint8 mode,bool closedLatched,uint64 closureNonce,uint64 reopenCandidateAt,uint64 oldValidUntil,uint64[2] reopenBaseObservations,uint64[2] lastOpenObservations,uint64 pauseNonce,uint64 bellStart,uint64 corporateUntil))']);
const TOKEN_ABI = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);
const AUCTION_REGISTRY_ABI = parseAbi(['function auctionFor(bytes32 poolId) view returns (address)']);
const AUCTION_ABI = parseAbi([
  'function currentStage() view returns (uint8)',
  'function blocksSwaps() view returns (bool)',
  'function openTime() view returns (uint64)',
  'function cycleDeadline() view returns (uint64)',
  'function cycleId() view returns (uint64)',
  'function minOrderSizeQuote() view returns (uint128)',
  'function minOrderSizeBase() view returns (uint128)',
  'function openTime() view returns (uint64)',
  'function auctionLead() view returns (uint32)',
  'function settleTimeout() view returns (uint32)',
  'function indicativeClearing() view returns (uint160,uint128)',
  'function orderCount() view returns (uint32)',
  'function totalOrderCount() view returns (uint32)',
  'function order(uint32) view returns ((address owner,uint128 amountIn,uint160 limitPriceX96,uint64 cycleId,bool isBuyer,bool cancelled,bool claimed))',
  'function allocation(uint64,uint32) view returns (uint128 baseFill,uint128 quotePayout,uint128 quoteRefund)',
  'function claimUnfilled(uint64,uint32)',
  'function armNext() returns (bool)',
  'function refund()',
  'function settle()',
]);

/**
 * Permissionless scheduled settlement for Opening Bell Auctions.
 *
 * The auction is P2P-only and computes its own maximum-volume price from limit orders. The keeper
 * arms a CLOSED -> PRE/OVERNIGHT cycle proven by CalendarRegistry, then submits settle() without a
 * price argument once the cycle is LOCKED. There is no oracle read, offchain price proposal, or AMM
 * residual in the settlement path.
 */
export async function settleBellAuctions(env, {
  nowSeconds = Math.floor(Date.now() / 1000),
  publicClient: injectedPublicClient,
  walletClient: injectedWalletClient,
  fetchPools = runPools,
} = {}) {
  const registry = env.BELL_AUCTION_REGISTRY;
  const txKey = env.BELL_TRANSACTION_PRIVATE_KEY;
  const rpcUrl = env.BELL_RPC_URL || env.RH_MAINNET_RPC_PRIMARY || env.RH_TESTNET_RPC_PRIMARY;
  if (!registry) return { status: 'skipped', reason: 'auction registry is not configured', results: [] };
  if (!rpcUrl || !txKey) return { status: 'skipped', reason: 'keeper signing key or RPC is not configured', results: [] };

  const account = privateKeyToAccount(txKey);
  const publicClient = injectedPublicClient ?? createPublicClient({ transport: http(rpcUrl) });
  const walletClient = injectedWalletClient ?? createWalletClient({ account, transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  const expectedChainId = Number(env.BELL_EXPECTED_CHAIN_ID || 4663);
  if (chainId !== expectedChainId) {
    return { status: 'failed', reason: `wrong chain ${chainId}, expected ${expectedChainId}`, results: [] };
  }

  let pools;
  let directoryResult;
  let doStub = null;
  let poolCache = null;
  try {
    if (env.KEEPER_DO) {
      try {
        const id = env.KEEPER_DO.idFromName('bell-keeper');
        doStub = env.KEEPER_DO.get(id);
        const cached = await doStub.fetch(new Request('https://do/poolcache'));
        poolCache = await cached.json();
      } catch { poolCache = null; }
    }
    directoryResult = await fetchPools(env, { client: publicClient, cache: poolCache });
    ({ pools } = directoryResult);
    // `/pools` uses this Durable Object cache too. Reusing and updating it here prevents the cron
    // from repeating the full factory scan and static metadata reads every minute.
    if (doStub && directoryResult?.cache) {
      const jsonSafe = JSON.stringify(directoryResult.cache, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value);
      await doStub.fetch(new Request('https://do/poolcache', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: jsonSafe,
      }));
      await doStub.fetch(new Request('https://do/hooks', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pools.map((pool) => pool.hook)),
      }));
    }
  } catch (error) {
    const detail = String(error?.shortMessage ?? error?.message ?? error).slice(0, 180);
    return { status: 'failed', reason: `pool directory unavailable: ${detail}`, results: [] };
  }

  const registryAddress = registry as `0x${string}`;
  const bound = await Promise.all(pools.map(async (pool) => {
    try {
      const auction = await publicClient.readContract({
        address: registryAddress,
        abi: AUCTION_REGISTRY_ABI,
        functionName: 'auctionFor',
        args: [pool.poolId],
      });
      if (auction === '0x0000000000000000000000000000000000000000') return null;
      const [stage, blocksSwaps, openTime, cycleDeadline, cycleId] = await Promise.all([
        publicClient.readContract({ address: auction, abi: AUCTION_ABI, functionName: 'currentStage' }),
        publicClient.readContract({ address: auction, abi: AUCTION_ABI, functionName: 'blocksSwaps' }),
        publicClient.readContract({ address: auction, abi: AUCTION_ABI, functionName: 'openTime' }),
        publicClient.readContract({ address: auction, abi: AUCTION_ABI, functionName: 'cycleDeadline' }),
        publicClient.readContract({ address: auction, abi: AUCTION_ABI, functionName: 'cycleId' }),
      ]);
      return { pool, auction, stage: Number(stage), blocksSwaps, openTime: Number(openTime), cycleDeadline: Number(cycleDeadline), cycleId: Number(cycleId) };
    } catch (error) {
      return { pool, error: String(error?.shortMessage ?? error?.message ?? error).slice(0, 160) };
    }
  }));

  const byPoolId = Object.fromEntries(bound.filter(Boolean).filter((x) => !x.error).map((x) => [
    x.pool.poolId.toLowerCase(),
    { address: x.auction, stage: x.stage, blocksSwaps: x.blocksSwaps, openTime: x.openTime, cycleDeadline: x.cycleDeadline },
  ]));

  // Each per-pool auction is reusable. Let it validate the CLOSED -> PRE/OVERNIGHT proof itself;
  // `armNext()` returns false when the current/next leaves are not the required adjacent phases.
  for (const item of bound) {
    if (!item || item.error) continue;
    if (item.stage === 5 && nowSeconds >= item.cycleDeadline) {
      try {
        const refundSimulation = await publicClient.simulateContract({
          address: item.auction,
          abi: AUCTION_ABI,
          functionName: 'refund',
          args: [],
          account,
        });
        const refundHash = await walletClient.writeContract(refundSimulation.request);
        const refundReceipt = await publicClient.waitForTransactionReceipt({ hash: refundHash });
        if (refundReceipt.status !== 'success') throw new Error(`auction refund finalization reverted (${refundHash})`);
        item.refundTx = refundHash;
      } catch (error) {
        // The refund may already have been finalized by a user's permissionless claim. That must
        // not prevent the next cycle from being armed after the calendar's next CLOSED transition.
        item.refundError = String(error?.shortMessage ?? error?.message ?? error).slice(0, 140);
      }
    }
    try {
      const sim = await publicClient.simulateContract({
        address: item.auction,
        abi: AUCTION_ABI,
        functionName: 'armNext',
        args: [],
        account,
      });
      if (sim.result === true) {
        const hash = await walletClient.writeContract(sim.request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') throw new Error(`armNext reverted (${hash})`);
        item.armedTx = hash;
      }
    } catch (error) {
      item.armError = String(error?.shortMessage ?? error?.message ?? error).slice(0, 160);
    }
  }

  // Re-read after arming so a newly created cycle is not mistaken for the previous terminal cycle.
  for (const item of bound) {
    if (!item || item.error) continue;
    try {
      const [stage, blocksSwaps, openTime, cycleDeadline, cycleId] = await Promise.all([
        publicClient.readContract({ address: item.auction, abi: AUCTION_ABI, functionName: 'currentStage' }),
        publicClient.readContract({ address: item.auction, abi: AUCTION_ABI, functionName: 'blocksSwaps' }),
        publicClient.readContract({ address: item.auction, abi: AUCTION_ABI, functionName: 'openTime' }),
        publicClient.readContract({ address: item.auction, abi: AUCTION_ABI, functionName: 'cycleDeadline' }),
        publicClient.readContract({ address: item.auction, abi: AUCTION_ABI, functionName: 'cycleId' }),
      ]);
      item.stage = Number(stage);
      item.blocksSwaps = blocksSwaps;
      item.openTime = Number(openTime);
      item.cycleDeadline = Number(cycleDeadline);
      item.cycleId = Number(cycleId);
    } catch (error) {
      item.error = String(error?.shortMessage ?? error?.message ?? error).slice(0, 160);
    }
  }

  for (const item of bound) {
    if (!item || item.error) continue;
    byPoolId[item.pool.poolId.toLowerCase()] = {
      address: item.auction,
      stage: item.stage,
      blocksSwaps: item.blocksSwaps,
      openTime: item.openTime,
      cycleDeadline: item.cycleDeadline,
    };
  }
  const eligible = eligibleAuctions(pools, byPoolId, nowSeconds);
  const eligibleByPool = new Map(eligible.map((x) => [x.pool.poolId.toLowerCase(), x.auction]));
  const results = [];

  // Keep per-pool failures isolated: a single malformed hook must not stop other auctions settling.
  for (const item of bound) {
    if (!item) continue;
    if (item.error) {
      results.push(auctionSettlementResult('unknown', 'failed', { hook: item.pool.hook, reason: item.error }));
      continue;
    }
    const auction = eligibleByPool.get(item.pool.poolId.toLowerCase());
    if (!auction) continue;

    try {
      const request = await publicClient.simulateContract({
        address: auction,
        abi: AUCTION_ABI,
        functionName: 'settle',
        args: [],
        account,
      });
      const hash = await walletClient.writeContract(request.request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`settlement reverted (${hash})`);
      results.push(auctionSettlementResult(auction, 'settled', {
        hook: item.pool.hook, poolId: item.pool.poolId, cycleId: item.cycleId, txHash: hash,
      }));
    } catch (error) {
      results.push(auctionSettlementResult(auction, 'not-settled', {
        hook: item.pool.hook,
        poolId: item.pool.poolId,
        reason: String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/[^\s"'`]+/g, '[url]').slice(0, 200),
      }));
    }
  }

  return {
    status: results.some((r) => r.status === 'settled') ? 'settled' : results.some((r) => r.status === 'failed') ? 'failed' : 'idle',
    checkedAt: nowSeconds,
    eligibleCount: eligible.length,
    results,
  };
}

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
 *
 * Calendar repair is deliberately NOT gated on a boundary window. The registry only exposes one
 * `currentInterval`, and it goes empty the moment the committed leaf expires. If a boundary tick
 * is missed — Cloudflare can delay or drop a cron, and a deploy can land mid-window — the calendar
 * stays empty until the NEXT boundary, which is four to eight hours later. That is exactly the
 * failure this run loop used to produce. So whenever `currentInterval` reads empty and the root
 * still covers now, the worker activates the leaf that is live right now, no matter the clock.
 */
export async function runScheduledMaintenance(env, { nowSeconds = Math.floor(Date.now() / 1000), force = false } = {}) {
  const inWindow = isScheduledMaintenanceWindow(nowSeconds);
  if (!inWindow && !force) return { status: 'skipped', reason: 'outside a US market session boundary window' };
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

/**
 * Bring every recovering pool back to tradable.
 *
 * A pool that misses a session boundary lands in RECOVERING with RECOVERY_PENDING. It comes back
 * with two permissionless `refreshState` calls about sixty seconds apart: the first starts the
 * candidate, the second confirms an advanced observation. Until then `canSwap` is false, so a
 * visitor would find a pool they cannot trade against and no indication why.
 *
 * The keeper already signs maintenance transactions and runs every minute, so it performs both
 * checkpoints itself. Only pools that actually report RECOVERY_PENDING are touched.
 */
export async function refreshRecoveringPools(env, { nowSeconds = Math.floor(Date.now() / 1000), hooks = [] } = {}) {
  const reasons = [];
  if (!hooks.length) return { status: 'skipped', reason: 'no known pools' };
  const txKey = env.BELL_TRANSACTION_PRIVATE_KEY;
  const rpcUrl = env.BELL_RPC_URL || env.RH_MAINNET_RPC_PRIMARY || env.RH_TESTNET_RPC_PRIMARY;
  if (!txKey || !rpcUrl) return { status: 'skipped', reason: 'keeper signing key or RPC is not configured' };
  const expectedChainId = Number(env.BELL_EXPECTED_CHAIN_ID || 4663);
  const account = privateKeyToAccount(txKey);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
  if (await publicClient.getChainId() !== expectedChainId) return { status: 'failed', reason: 'wrong chain' };

  const RECOVERY_PENDING = 1n << 12n;
  const HOOK_ABI = parseAbi([
    'function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
    'function refreshState() returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
  ]);

  const out = {};
  for (const hook of hooks) {
    try {
      const policy = await publicClient.readContract({ address: hook, abi: HOOK_ABI, functionName: 'getPolicy' });
      if (policy.canSwap) { out[hook] = 'tradable'; continue; }
      if ((BigInt(policy.reasonBits) & RECOVERY_PENDING) === 0n) { out[hook] = 'not-recovering'; continue; }
      const { request } = await publicClient.simulateContract({ address: hook, abi: HOOK_ABI, functionName: 'refreshState', account });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`refreshState reverted (${hash})`);
      out[hook] = { status: 'checkpointed', txHash: hash };
      reasons.push(hook);
    } catch (error) {
      out[hook] = { status: 'failed', reason: String(error?.shortMessage ?? error?.message ?? error).slice(0, 160) };
    }
  }
  return { status: 'ok', pools: out };
}

/** Public read-only directory for pools emitted by the deployed Mainnet factory. */
export async function runPools(env, { client, fetchImpl = fetch, cache = null } = {}) {
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
  const genesisBlock = BigInt(env.BELL_POOL_SCAN_FROM_BLOCK || '101800000');
  const blockNumber = await chain.getBlockNumber();

  // Cloudflare caps one invocation at 50 subrequests. With five live pools the per-pool reads alone
  // consumed forty-five, and the log scan pushed the total past the cap, so the whole directory
  // answered 503. The scan is now incremental (resume from the last seen block) and immutable pool
  // metadata is cached, leaving only the three reads that actually change per request.
  const cachedStatic: Record<string, any> = cache?.static ?? {};
  const scanFrom = cache?.cursor && BigInt(cache.cursor) + 1n > genesisBlock
    ? BigInt(cache.cursor) + 1n
    : genesisBlock;

  let logs: any[] = [];
  if (blockNumber >= scanFrom) {
    try {
      const span = blockNumber - scanFrom + 1n;
      const pages = BigInt(Math.min(POOL_SCAN_MAX_PAGES, Number(span)));
      const pageSize = (span + pages - 1n) / pages;
      const ranges: Array<[bigint, bigint]> = [];
      for (let start = scanFrom; start <= blockNumber; start += pageSize) {
        const end = start + pageSize - 1n < blockNumber ? start + pageSize - 1n : blockNumber;
        ranges.push([start, end]);
      }
      const chunks: unknown[] = [];
      for (const [start, end] of ranges) {
        chunks.push(await chain.request({ method: 'eth_getLogs', params: [{
          address: factory, fromBlock: toHex(start), toBlock: toHex(end), topics: [toEventSelector(POOL_CREATED_EVENT)],
        }] } as any));
      }
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
      legacy.search = new URLSearchParams({ module: 'logs', action: 'getLogs', fromBlock: String(scanFrom), toBlock: 'latest', address: factory }).toString();
      // Blockscout rejects custom User-Agent strings on this public compatibility API.
      const response = await fetchImpl(legacy, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw quoteError(`pool index unavailable after RPC log read (${rpcDetail}): ${response.status}`, 503);
      const page = await response.json();
      if (!Array.isArray(page?.result)) throw quoteError(`pool logs unavailable (${String(rpcError?.shortMessage ?? rpcError?.message ?? 'RPC error').slice(0, 120)})`, 503);
      logs = page.result;
    }
  }
  if (!Array.isArray(logs)) throw quoteError('chain RPC returned malformed factory logs', 503);

  const found = new Map<string, any>();
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: [POOL_CREATED_EVENT], data: log.data, topics: log.topics });
      const hook = decoded.args.hook;
      if (hook) found.set(String(hook).toLowerCase(), { args: decoded.args, blockNumber: BigInt(log.blockNumber) });
    } catch { /* Ignore unrelated factory events; only PoolCreated rows are surfaced. */ }
  }

  // Merge newly discovered hooks with the cached ones, preserving first-seen metadata.
  const staticCache: Record<string, any> = { ...cachedStatic };
  for (const [key, log] of found) {
    if (staticCache[key]) continue;
    staticCache[key] = { poolId: log.args.poolId, createdAtBlock: String(log.blockNumber), config: null, legs: null };
  }

  const EXTSLOAD_MANY_ABI = parseAbi(['function extsload(bytes32[]) view returns (bytes32[])']);
  const strings = (values) => Array.from(values, (value) => String(value));

  // Pools are processed one at a time. Twenty concurrent reads tripped the free-tier RPC's rate
  // limit, and the swallowed failures surfaced as a funded pool reporting no liquidity at random.
  const pools = [];
  for (const [key, entry] of Object.entries(staticCache)) {
    pools.push(await readPool(key, entry));
  }

  async function readPool(key: string, entry: any) {
    const hook = entry.hook ?? key;
    const poolId = entry.poolId;

    // Immutable metadata is read once per pool and then cached.
    let config = entry.config;
    let legs = entry.legs;
    if (!config || !legs) {
      config = await chain.readContract({ address: hook, abi: POOL_CONFIG_ABI, functionName: 'config' });
      const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([
        chain.readContract({ address: config.token0, abi: TOKEN_ABI, functionName: 'symbol' }),
        chain.readContract({ address: config.token1, abi: TOKEN_ABI, functionName: 'symbol' }),
        chain.readContract({ address: config.token0, abi: TOKEN_ABI, functionName: 'decimals' }),
        chain.readContract({ address: config.token1, abi: TOKEN_ABI, functionName: 'decimals' }),
      ]);
      legs = [
        { address: config.token0, symbol: symbol0, decimals: Number(decimals0) },
        { address: config.token1, symbol: symbol1, decimals: Number(decimals1) },
      ];
      entry.config = config;
      entry.legs = legs;
      entry.hook = hook;
    }

    // Only these three reads change between requests. Both pool-manager slots come from one
    // batched extsload: twenty concurrent single-slot calls tripped the free-tier rate limit, and
    // the last pool in the list reported no liquidity on every request.
    const base = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [poolId, 6n]));
    const liquiditySlot = '0x' + (BigInt(base) + 3n).toString(16).padStart(64, '0') as `0x${string}`;
    const [policy, lifecycle, poolStorage] = await Promise.all([
      chain.readContract({ address: hook, abi: POOL_POLICY_ABI, functionName: 'getPolicy' }),
      chain.readContract({ address: hook, abi: POOL_STATE_ABI, functionName: 'state' }).catch(() => null),
      chain.readContract({ address: config.poolManager, abi: EXTSLOAD_MANY_ABI, functionName: 'extsload', args: [[base, liquiditySlot]] }).catch(() => null),
    ]);
    const slot0 = poolStorage?.[0] ?? null;
    const liquidityWord = poolStorage?.[1] ?? null;

    let poolSqrtPriceX96 = null;
    let poolTick = null;
    if (slot0) {
      const word = BigInt(slot0);
      const sqrt = word & ((1n << 160n) - 1n);
      poolSqrtPriceX96 = sqrt === 0n ? null : sqrt;
      poolTick = Number(BigInt.asIntN(24, word >> 160n));
    }
    const poolLiquidity = liquidityWord === undefined || liquidityWord === null ? null : BigInt(liquidityWord) & ((1n << 128n) - 1n);

    return {
      hook, poolId, lifecycle: lifecycle ? Number(lifecycle.lifecycle) : 0,
      poolManager: config.poolManager, token0: config.token0, token1: config.token1,
      asset0: config.asset0, asset1: config.asset1, configHash: policy.configHash,
      poolClass: Number(config.poolClass), liquidityMode: Number(config.liquidityMode), tickSpacing: Number(config.tickSpacing),
      tradeCap: strings(config.tradeCap), windowCap: strings(config.windowCap),
      poolLiquidity: poolLiquidity === null ? null : String(poolLiquidity),
      poolSqrtPriceX96: poolSqrtPriceX96 === null ? null : String(poolSqrtPriceX96),
      poolTick,
      funded: poolLiquidity === null ? null : poolLiquidity > 0n,
      policy: {
        canSwap: policy.canSwap, mode: Number(policy.mode), phase: Number(policy.phase), flags: Number(policy.flags),
        reasonBits: String(policy.reasonBits), lpFeeUnits: Number(policy.lpFeeUnits), bandBps: Number(policy.bandBps),
        effectiveTradeCap: strings(policy.effectiveTradeCap), effectiveWindowCap: strings(policy.effectiveWindowCap),
        rollingRemaining: strings(policy.rollingRemaining), closureRemaining: strings(policy.closureRemaining),
        referencePrice18: strings(policy.referencePrice18), validUntil: String(policy.validUntil), closureNonce: String(policy.closureNonce),
      },
      legs,
      createdAtBlock: entry.createdAtBlock,
    };
  }

  return { chainId, blockNumber: String(blockNumber), pools, cache: { cursor: String(blockNumber), static: staticCache } };
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
  // Same Cloudflare subrequest ceiling as the pool directory: size the pages to the budget and run
  // them sequentially instead of firing one request per fixed window in parallel.
  const span = latest >= start ? latest - start + 1n : 0n;
  const ranges: Array<[bigint, bigint]> = [];
  if (span > 0n) {
    const pages = BigInt(Math.min(POOL_SCAN_MAX_PAGES, Number(span)));
    const pageSize = (span + pages - 1n) / pages;
    for (let from = start; from <= latest; from += pageSize) {
      ranges.push([from, from + pageSize - 1n < latest ? from + pageSize - 1n : latest]);
    }
  }
  const candidates = new Set<string>();
  for (const [fromBlock, toBlock] of ranges) {
    const chunk = await chain.request({ method: 'eth_getLogs', params: [{
      address: manager, fromBlock: toHex(fromBlock), toBlock: toHex(toBlock), topics: [selector, null, ownerTopic],
    }] } as any);
    for (const log of Array.isArray(chunk) ? chunk : []) {
      if (log.topics?.[3]) candidates.add(BigInt(log.topics[3]).toString());
    }
  }
  return { chainId: expectedChainId, owner: owner.toLowerCase(), blockNumber: latest.toString(), tokenIds: [...candidates] };
}

/** Runs one keeper tick. Exported so it can be exercised without Cloudflare bindings. */
export async function runTick(env, { nowSeconds = Math.floor(Date.now() / 1000), fetchQuote = fetchYahooChartQuote } = {}) {
  if (env.BELL_ORACLE_MODE === 'pull') return { status: 'skipped', reason: 'scheduled transactions disabled in pull mode' };
  // In Chainlink mode the deployed policy reads feeds onchain, so there is nothing for the Yahoo
  // push path to publish. Returning early keeps the reason truthful instead of surfacing a missing
  // Yahoo adapter as "keeper addresses are not configured".
  if (env.BELL_ORACLE_MODE === 'chainlink') {
    return { status: 'skipped', reason: 'Yahoo push publishing is disabled in chainlink mode; prices come from onchain feeds' };
  }
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
    // force=true: every cron tick repairs an empty calendar regardless of the boundary guard.
    // Boundary-only work (close capture) still self-gates inside the run.
    ctx.waitUntil(runScheduledMaintenance(env, { nowSeconds, force: true }).then(async (result) => {
      console.log('scheduled market maintenance', JSON.stringify(result));
      // Bring any recovering pool back to tradable. Without this a missed boundary leaves a pool
      // the visitor cannot trade against until someone finds the checkpoint button.
      let poolRecovery = null;
      try {
        const id = env.KEEPER_DO.idFromName('bell-keeper');
        const hooksRes = await env.KEEPER_DO.get(id).fetch(new Request('https://do/hooks'));
        const { hooks } = await hooksRes.json();
        if (Array.isArray(hooks) && hooks.length > 0) {
          poolRecovery = await refreshRecoveringPools(env, { nowSeconds, hooks });
          console.log('scheduled pool recovery', JSON.stringify(poolRecovery));
        }
      } catch (error) {
        console.error('pool recovery failed', String(error?.message ?? error).slice(0, 160));
      }
      // Opening Bell settlement is independent of feed freshness. The on-chain auction rechecks
      // every order and residual; if the pool-price proposal does not clear, simulation fails and
      // the permissionless refund path remains available at timeout.
      let auctionSettlement = null;
      try {
        auctionSettlement = await settleBellAuctions(env, { nowSeconds });
        console.log('scheduled auction settlement', JSON.stringify(auctionSettlement));
      } catch (error) {
        const reason = String(error?.shortMessage ?? error?.message ?? error)
          .replace(/https?:\/\/[^\s"'`]+/g, '[url]').slice(0, 180);
        auctionSettlement = { status: 'threw', reason, results: [] };
        console.error('scheduled auction settlement failed', reason);
      }
      // Persist the outcome where /status can read it. A repair that only exists in the log is a
      // repair nobody notices failing, which is how the calendar stayed empty for two days.
      try {
        const id = env.KEEPER_DO.idFromName('bell-keeper');
        await env.KEEPER_DO.get(id).fetch(new Request('https://do/maintenance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...result, poolRecovery, auctionSettlement }),
        }));
      } catch (error) {
        const detail = String(error?.message ?? error).slice(0, 140);
        console.error('could not record maintenance result', detail);
      }
      try {
        const id = env.KEEPER_DO.idFromName('bell-keeper');
        await env.KEEPER_DO.get(id).fetch(new Request('https://do/auction-settlement', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(auctionSettlement ?? { status: 'skipped', reason: 'no result' }),
        }));
      } catch (error) {
        console.error('could not record auction settlement result', String(error?.message ?? error).slice(0, 140));
      }
    }).catch(async (error) => {
      const detail = String(error?.shortMessage ?? error?.message ?? error)
        .replace(/https?:\/\/[^\s"'`]+/g, '[url]').slice(0, 220);
      console.error('scheduled market maintenance failed', detail);
      try {
        const id = env.KEEPER_DO.idFromName('bell-keeper');
        await env.KEEPER_DO.get(id).fetch(new Request('https://do/maintenance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'threw', reason: detail }),
        }));
      } catch { /* nothing further to do if the recorder itself is unreachable */ }
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
      try {
        // Reuse the incremental scan cache so the request stays inside the 50-subrequest budget.
        let cache = null;
        let doStub = null;
        try {
          doStub = env.KEEPER_DO.get(env.KEEPER_DO.idFromName('bell-keeper'));
          const cached = await doStub.fetch(new Request('https://do/poolcache'));
          cache = await cached.json();
        } catch { cache = null; }
        const pools = await runPools(env, { cache });
        // Persist the cache and the hook list for scheduled maintenance. The cached config holds
        // BigInt cap values, and JSON.stringify refuses them outright — a plain stringify threw and
        // the cache was never written, so every request repeated the whole factory log scan.
        const jsonSafe = (value) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
        if (doStub) {
          try {
            await doStub.fetch(new Request('https://do/poolcache', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: jsonSafe(pools.cache),
            }));
            await doStub.fetch(new Request('https://do/hooks', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(pools.pools.map((p) => p.hook)),
            }));
          } catch (error) {
            console.error('pool cache write failed', String(error?.message ?? error).slice(0, 160));
          }
        }
        const { cache: _omit, ...response } = pools;
        return cors(json(response));
      }
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
    if (env.BELL_ORACLE_MODE === 'chainlink' && ['/tick', '/ensure-alarm'].includes(url.pathname)) {
      return json({ error: 'Yahoo push entry points are disabled in chainlink mode; boundary maintenance runs on the cron schedule' }, 409);
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
        try {
          const live = await runChainlinkStatus(env);
          // Attach the last scheduled maintenance outcome. It runs in the worker rather than this
          // object, so without this the only record of a failed calendar repair is a log line.
          let maintenance = null;
          try {
            const id = env.KEEPER_DO.idFromName('bell-keeper');
            const res = await env.KEEPER_DO.get(id).fetch(new Request('https://do/status'));
            const doStatus = await res.json();
            maintenance = {
              lastMaintenance: doStatus.lastMaintenance ?? null,
              maintenanceLog: doStatus.maintenanceLog ?? [],
              lastAuctionSettlement: doStatus.lastAuctionSettlement ?? null,
              auctionSettlementLog: doStatus.auctionSettlementLog ?? [],
            };
          } catch { /* maintenance history is best-effort; live status still returns */ }
          return cors(json({ ...live, ...maintenance }));
        } catch (error) {
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
