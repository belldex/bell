import { createPublicClient, http, parseAbi } from 'viem';
import { hashCalendarLeaf } from '@bell/protocol/calendar';

const MAX_SESSION_FEED_AGE_SECONDS = 120;
const CALENDAR_ABI = parseAbi([
  'function currentInterval(bytes32) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
]);
const ASSET_ABI = parseAbi([
  'function descriptor(bytes32) view returns ((bytes32 id,address token,bool isStock,uint8 decimals,uint8 capabilityMask,address tokenPriceAdapter,address regularAdapter,address extendedAdapter,address overnightAdapter,address secondaryAdapter,bytes32 expectedCodeHash,bytes32 implementationFingerprint,bytes32 evidenceHash))',
]);
const SESSION_ABI = parseAbi([
  'function anchorStatus(bytes32,bytes32) view returns ((bytes32 assetId,bytes32 boundaryHash,uint128 price18,uint128 multiplier18,uint64 capturedAt,uint64 observedAt,uint64 inputAt,uint64 closureStart,bytes32 sourceHash),bool valid,uint256 reasons,uint64 validUntil)',
]);
const ADAPTER_ABI = parseAbi([
  'function feed() view returns (address)',
  'function fingerprint() view returns (bytes32)',
  'function readCurrent() view returns ((bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash))',
]);
const FEED_ABI = parseAbi([
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
]);

const SESSION_NAME = Object.freeze({ 0: 'UNKNOWN', 1: 'PRE', 2: 'REGULAR', 3: 'POST', 4: 'OVERNIGHT', 5: 'CLOSED' });

function tupleField(tuple, index, name) {
  return tuple?.[name] ?? tuple?.[index];
}

function selectedAdapter(descriptor, phase) {
  if (phase === 2) return descriptor.regularAdapter;
  if (phase === 4) return descriptor.overnightAdapter;
  if (phase === 1 || phase === 3) return descriptor.extendedAdapter;
  return null;
}

/** Read current market phase, closed anchor state, and onchain Chainlink freshness without writes. */
export async function runChainlinkStatus(env, { client, nowSeconds } = {}) {
  const assets = JSON.parse(env.BELL_STOCK_ASSETS || '[]');
  const required = ['BELL_ASSET_REGISTRY', 'BELL_CALENDAR_REGISTRY', 'BELL_SESSION_REGISTRY'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length || assets.length === 0) throw new Error(`Chainlink status is not configured: ${missing.join(', ') || 'no stock assets'}`);

  const chain = client ?? createPublicClient({ transport: http(env.BELL_RPC_URL || env.RH_MAINNET_RPC_PRIMARY) });
  const [chainId, block] = await Promise.all([chain.getChainId(), chain.getBlock()]);
  const expectedChainId = Number(env.BELL_EXPECTED_CHAIN_ID || 4663);
  if (chainId !== expectedChainId) throw new Error(`wrong chain ${chainId}, expected ${expectedChainId}`);
  const observedAt = Number(nowSeconds ?? block.timestamp);
  const readAtBlock = (request) => chain.readContract({ ...request, blockNumber: block.number });
  const output = {};

  for (const { symbol, assetId } of assets) {
    const interval = await readAtBlock({
      address: env.BELL_CALENDAR_REGISTRY, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [assetId],
    });
    const phase = Number(interval.phase);
    const result = {
      phase,
      session: SESSION_NAME[phase] ?? 'UNKNOWN',
      intervalStart: Number(interval.start),
      intervalEnd: Number(interval.end),
      sessionFeedFresh: null,
      feedAgeSeconds: null,
      status: 'unknown',
    };

    if (phase === 5) {
      const boundaryHash = hashCalendarLeaf({
        chainId, calendarRegistry: env.BELL_CALENDAR_REGISTRY, assetId,
        year: Number(interval.year), index: Number(interval.index), start: interval.start,
        end: interval.end, phase, provenanceHash: interval.provenanceHash,
      });
      const anchor = await readAtBlock({
        address: env.BELL_SESSION_REGISTRY, abi: SESSION_ABI, functionName: 'anchorStatus', args: [assetId, boundaryHash],
      });
      result.anchorValid = Boolean(tupleField(anchor, 1, 'valid'));
      result.anchorValidUntil = Number(tupleField(anchor, 3, 'validUntil'));
      result.status = result.anchorValid ? 'closed-anchor-valid' : 'closed-anchor-missing';
      result.freshnessLimitSeconds = MAX_SESSION_FEED_AGE_SECONDS;
      try {
        const descriptor = await readAtBlock({
          address: env.BELL_ASSET_REGISTRY, abi: ASSET_ABI, functionName: 'descriptor', args: [assetId],
        });
        const adapter = descriptor.isStock ? descriptor.regularAdapter : null;
        if (adapter && adapter !== '0x0000000000000000000000000000000000000000') {
          const [feed, fingerprint] = await Promise.all([
            readAtBlock({ address: adapter, abi: ADAPTER_ABI, functionName: 'feed' }),
            readAtBlock({ address: adapter, abi: ADAPTER_ABI, functionName: 'fingerprint' }),
          ]);
          if (fingerprint && !/^0x0{64}$/i.test(fingerprint)) {
            const round = await readAtBlock({ address: feed, abi: FEED_ABI, functionName: 'latestRoundData' });
            const roundId = BigInt(tupleField(round, 0, 'roundId'));
            const answer = BigInt(tupleField(round, 1, 'answer'));
            const updatedAt = Number(tupleField(round, 3, 'updatedAt'));
            const answeredInRound = BigInt(tupleField(round, 4, 'answeredInRound'));
            const age = observedAt - updatedAt;
            if (roundId > 0n && answeredInRound >= roundId && answer > 0n && updatedAt > 0 && age >= 0) {
              result.feedAgeSeconds = age;
              result.updatedAt = updatedAt;
            }
          }
        }
      } catch {
        // Closed-anchor status remains useful when optional feed-age telemetry is unavailable.
      }
      output[symbol] = result;
      continue;
    }

    if (phase < 1 || phase > 4) {
      result.status = 'calendar-uninitialized';
      output[symbol] = result;
      continue;
    }

    const descriptor = await readAtBlock({
      address: env.BELL_ASSET_REGISTRY, abi: ASSET_ABI, functionName: 'descriptor', args: [assetId],
    });
    const adapter = selectedAdapter(descriptor, phase);
    if (!descriptor.isStock || !adapter || adapter === '0x0000000000000000000000000000000000000000') {
      result.status = 'session-adapter-missing';
      result.sessionFeedFresh = false;
      output[symbol] = result;
      continue;
    }

    const [feed, fingerprint] = await Promise.all([
      readAtBlock({ address: adapter, abi: ADAPTER_ABI, functionName: 'feed' }),
      readAtBlock({ address: adapter, abi: ADAPTER_ABI, functionName: 'fingerprint' }),
    ]);
    result.adapter = adapter;
    result.feed = feed;
    if (!fingerprint || /^0x0{64}$/i.test(fingerprint)) {
      result.status = 'adapter-fingerprint-invalid';
      result.sessionFeedFresh = false;
      output[symbol] = result;
      continue;
    }

    const round = await readAtBlock({ address: feed, abi: FEED_ABI, functionName: 'latestRoundData' });
    const roundId = BigInt(tupleField(round, 0, 'roundId'));
    const answer = BigInt(tupleField(round, 1, 'answer'));
    const updatedAt = Number(tupleField(round, 3, 'updatedAt'));
    const answeredInRound = BigInt(tupleField(round, 4, 'answeredInRound'));
    const age = observedAt - updatedAt;
    result.feedAgeSeconds = age;
    result.updatedAt = updatedAt;
    result.freshnessLimitSeconds = MAX_SESSION_FEED_AGE_SECONDS;
    const roundValid = roundId > 0n && answeredInRound >= roundId && answer > 0n && updatedAt > 0 && age >= 0;
    if (!roundValid || age >= MAX_SESSION_FEED_AGE_SECONDS) {
      result.sessionFeedFresh = false;
      result.status = roundValid ? 'stale' : 'invalid-feed-round';
      output[symbol] = result;
      continue;
    }

    try {
      await readAtBlock({ address: adapter, abi: ADAPTER_ABI, functionName: 'readCurrent' });
      result.sessionFeedFresh = true;
      result.status = 'fresh';
    } catch {
      result.sessionFeedFresh = false;
      result.status = 'adapter-rejected-round';
    }
    output[symbol] = result;
  }

  const statuses = Object.values(output).map((entry) => entry.status);
  const allClosed = statuses.every((status) => status.startsWith('closed-anchor-'));
  const overall = allClosed
    ? statuses.every((status) => status === 'closed-anchor-valid')
      ? 'closed-anchor-ready'
      : statuses.every((status) => status === 'closed-anchor-missing')
        ? 'closed-anchor-missing'
        : 'closed-anchor-pending'
    : statuses.every((status) => status === 'fresh')
      ? 'fresh'
      : statuses.some((status) => status === 'calendar-uninitialized' || status === 'session-adapter-missing' || status === 'adapter-fingerprint-invalid' || status === 'invalid-feed-round')
        ? 'configuration-error'
        : 'waiting-for-fresh-feed';
  return {
    mode: 'chainlink',
    chainId,
    blockNumber: Number(block.number),
    blockTimestamp: Number(block.timestamp),
    checkedAt: observedAt,
    freshnessLimitSeconds: MAX_SESSION_FEED_AGE_SECONDS,
    status: overall,
    assets: output,
  };
}
