/**
 * BELL keeper Worker.
 *
 * Runs on a Durable Object alarm every 30 seconds. Each tick:
 *   1. reads the active onchain calendar phase for the configured rehearsal asset
 *   2. fetches a Yahoo quote and refuses to publish if the phase does not match
 *   3. signs and publishes the direct sample, the phase-matched stream report, and refreshes health
 *
 * A closed market or a stale quote is a normal state: the tick records why it skipped and the
 * alarm keeps running. Hard failures are recorded in the Durable Object so they are visible from
 * /status instead of dying silently with the process.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { signYahooSourceSample } from '@bell/protocol/yahoo-attestation';
import { fetchYahooChartQuote } from '@bell/protocol/yahoo-quote';
import { evaluateQuote, phaseNameForCalendarPhase, reportValidUntil, wireForCalendarPhase, ZERO32 } from './tick-policy.mjs';
import { KeeperState, nextAlarmTimestamp } from './keeper-state.mjs';

export { KeeperState };

const CALENDAR_ABI = parseAbi([
  'function currentInterval(bytes32) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
]);
const SESSION_ABI = parseAbi([
  'function submitReports(bytes32,bytes[])',
  'function refreshHealth(bytes32) returns (uint256)',
  'function health(bytes32) view returns ((bool ready,uint256 reasonBits,uint64 healthySince,uint64 validUntil,uint64 baselineObservation,uint64 latestObservation))',
]);
const DIRECT_ABI = parseAbi([
  'function publishDirect((bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash),bytes)',
]);
const HOOK_ABI = parseAbi([
  'function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Runs one keeper tick. Exported so it can be exercised without Cloudflare bindings. */
export async function runTick(env, { nowSeconds = Math.floor(Date.now() / 1000), fetchQuote = fetchYahooChartQuote } = {}) {
  // The RPC is configuration, not a testnet assumption. BELL_RPC_URL wins; the testnet variable is
  // kept as a fallback so an existing deployment keeps working unchanged.
  const rpcUrl = env.BELL_RPC_URL || env.RH_TESTNET_RPC_PRIMARY;
  if (!rpcUrl) return { status: 'skipped', reason: 'BELL_RPC_URL is not configured' };
  if (!env.YAHOO_REPORTER_PRIVATE_KEY) return { status: 'skipped', reason: 'YAHOO_REPORTER_PRIVATE_KEY is not configured' };

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

  const account = privateKeyToAccount(env.YAHOO_REPORTER_PRIVATE_KEY);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

  const chainId = await publicClient.getChainId();
  // The keeper used to hardcode testnet 46630, which made a mainnet deployment unpublishable no
  // matter what the vars said. The expected chain is configuration now.
  const expectedChainId = Number(env.BELL_EXPECTED_CHAIN_ID || 46630);
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
  async fetch(request, env) {
    const url = new URL(request.url);
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
