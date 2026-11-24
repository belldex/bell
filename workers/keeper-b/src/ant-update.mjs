/**
 * Builds the oracle update a swap carries for ANT, signed by the ANT delegate key.
 *
 * ANT has no Chainlink feed, so its price comes from Robinhood's pricing API, attested by the DelegatedAttestedSourceAdapter. Publishing it
 * on chain every 45 seconds costs about 0.0007 ETH an hour; instead the swapper's own transaction carries the report (the router passes
 * `oracleUpdates` to the SessionRegistry), so the only gas is the swap's. This module returns exactly the arguments
 * `refreshStockWithReports(assetId, directSample, directSignature, reports)` takes, in the shape of an `OraclePullUpdate`.
 *
 * The key is a delegate: each adapter lets it sign for at most 25 hours, renewed by a hybrid-signed REPORTER call, and it can sign nothing but
 * ANT reports. The price is only ever read from the official pricing API, never from the caller, and an update lives 100 seconds.
 */
import { keccak256, stringToHex, encodeAbiParameters, parseAbiParameters, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ADAPTER_ABI = parseAbi(['function reportDigest(bytes32 payloadHash,uint256 deadline) view returns (bytes32)']);
const CALENDAR_ABI = parseAbi(['function currentInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']);
const SAMPLE = '(bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash)';
const ADAPTER_NAMES = ['tokenPriceAdapter', 'regularAdapter', 'extendedAdapter', 'overnightAdapter'];
const SCOPE_OF_PHASE = { 1: 2, 2: 1, 3: 2, 4: 3 }; // calendar phase PRE, REGULAR, POST, OVERNIGHT -> the adapter that carries the session report
const ZERO32 = `0x${'0'.repeat(64)}`;

export class AntUpdateError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

/** Official price: Robinhood's own pricing API, bid/ask already multiplier-adjusted. Refuses a halt, a wide spread and an old quote. */
export async function readAntPrice(symbol, fetchImpl = fetch, nowMs = Date.now()) {
  let q;
  try {
    const r = await fetchImpl(`https://api.robinhood.com/rhj/prices/${symbol}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    q = (await r.json()).quotes?.[0];
  } catch { throw new AntUpdateError('price source unavailable', 503); }
  if (!q) throw new AntUpdateError('price source returned no quote', 503);
  if (q.isTradingHalt) throw new AntUpdateError('the asset is halted: no report is signed');
  const bid = Number(q.tokenBid); const ask = Number(q.tokenAsk);
  if (!(bid > 0 && ask >= bid)) throw new AntUpdateError('bad bid/ask');
  if ((ask - bid) / ((ask + bid) / 2) > 0.02) throw new AntUpdateError('spread wider than 2 percent: no report is signed');
  if (nowMs - Date.parse(q.generatedAt) > 60_000) throw new AntUpdateError('the quote is older than 60 seconds');
  return (bid + ask) / 2;
}

/** `cfg` is { assetId, calendarRegistry, adapters: {name: address}, feedIds: [direct, regular, extended, overnight] }. */
export async function buildAntUpdate({ cfg, delegateKey, client, fetchImpl = fetch, symbol = 'ANT' }) {
  if (!cfg?.assetId || !cfg.adapters || !cfg.feedIds || !delegateKey) throw new AntUpdateError('ANT updates are not configured', 503);
  const delegate = privateKeyToAccount(delegateKey.startsWith('0x') ? delegateKey : `0x${delegateKey}`);
  const price = await readAntPrice(symbol, fetchImpl);
  const [block, interval] = await Promise.all([
    client.getBlock(),
    client.readContract({ address: cfg.calendarRegistry, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [cfg.assetId] }),
  ]);
  const now = Number(block.timestamp);
  const phase = Number(interval.phase);
  if (BigInt(now) < interval.start || BigInt(now) >= interval.end || !(phase in SCOPE_OF_PHASE)) throw new AntUpdateError('no active session to report for');
  const scope = SCOPE_OF_PHASE[phase];
  const price18 = BigInt(Math.round(price * 1e6)) * 10n ** 12n;
  const mk = (feedId, samplePhase, tag) => ({
    descriptorId: ZERO32, feedId, phase: samplePhase, price18, observedAt: BigInt(now - 3), inputAt: BigInt(now - 3), validFrom: BigInt(now - 3),
    expiresAt: BigInt(now + 100), validUntil: BigInt(now + 100), reportHash: keccak256(stringToHex(`${tag}:${price18}:${now}`)),
  });
  const deadline = BigInt(now + 110);
  const sign = async (adapter, sample) => {
    const payload = keccak256(encodeAbiParameters(parseAbiParameters(`address adapter, ${SAMPLE} sample`), [adapter, sample]));
    const digest = await client.readContract({ address: adapter, abi: ADAPTER_ABI, functionName: 'reportDigest', args: [payload, deadline] });
    return delegate.sign({ hash: digest });
  };
  const direct = mk(cfg.feedIds[0] ?? ZERO32, 0, 'direct');
  const stream = mk(cfg.feedIds[scope], phase, `stream${scope}`);
  const [directSig, streamSig] = await Promise.all([sign(cfg.adapters[ADAPTER_NAMES[0]], direct), sign(cfg.adapters[ADAPTER_NAMES[scope]], stream)]);
  const directSignature = encodeAbiParameters(parseAbiParameters('uint256 deadline, bytes ecdsa, bytes pq'), [deadline, directSig, '0x']);
  const report = encodeAbiParameters(parseAbiParameters(`${SAMPLE} sample, uint256 deadline, bytes ecdsa, bytes pq`), [stream, deadline, streamSig, '0x']);
  const text = (sample) => Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
  return { assetId: cfg.assetId, directSample: text(direct), directSignature, reports: [report], closeBoundaryHash: ZERO32, price, session: phase, validUntil: now + 100 };
}
