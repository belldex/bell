/**
 * Einstein Hooks v3 Evolve: the LP economics of one pool, computed from Swap events only. No network here, so it can be tested offline
 * and the replay script runs the very same code that builds the page.
 *
 * Conventions (all fixed in evidence/einstein/v3-evolve/method.json before a run starts):
 *  - Swap event amounts are from the swapper's side: a negative amount is what the swapper paid in, a positive amount is what it got.
 *  - Every value is in USDG, marked at one reference price per swap and at one end price for the headline.
 *  - A position is a constant liquidity L between two ticks. Its fee share of a swap is L divided by the pool liquidity in the event,
 *    and zero when the pool tick is outside the position's range.
 */
import { buildEtMarketIntervals } from '../../calendar/et-market-calendar.mjs';

export const SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const Q96 = 2 ** 96;
const MIN_TICK = -887272;
const MAX_TICK = 887272;

const signed = (hex) => { let v = BigInt(`0x${hex}`); if (v >= 2n ** 255n) v -= 2n ** 256n; return v; };
const word = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64);

/** Decodes a PoolManager Swap log: Swap(id, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee). */
export function decodeSwap(log) {
  const tick = Number(signed(word(log.data, 4)));
  return {
    poolId: log.topics[1], sender: `0x${log.topics[2].slice(26)}`,
    amount0: signed(word(log.data, 0)), amount1: signed(word(log.data, 1)),
    sqrtPriceX96: BigInt(`0x${word(log.data, 2)}`), liquidity: BigInt(`0x${word(log.data, 3)}`),
    tick, fee: parseInt(word(log.data, 5), 16),
    block: Number(BigInt(log.blockNumber)), tx: log.transactionHash, logIndex: Number(BigInt(log.logIndex)),
  };
}

export const sqrtAtTick = (tick) => 1.0001 ** (Math.max(MIN_TICK, Math.min(MAX_TICK, tick)) / 2);

/** Raw token amounts held by a position of liquidity L between two ticks when the pool sits at sqrtP (a plain number, price^0.5). */
export function positionAmounts(L, sqrtP, tickLower, tickUpper) {
  const a = sqrtAtTick(tickLower); const b = sqrtAtTick(tickUpper);
  const p = Math.max(a, Math.min(b, sqrtP));
  return { amount0: L * (b - p) / (p * b), amount1: L * (p - a) };
}

/** The liquidity that a deposit of the two amounts makes at the starting price, the way the position manager rounds it down. */
export function liquidityFor(amount0, amount1, sqrtP, tickLower, tickUpper) {
  const a = sqrtAtTick(tickLower); const b = sqrtAtTick(tickUpper);
  if (sqrtP <= a) return amount0 * (a * b) / (b - a);
  if (sqrtP >= b) return amount1 / (b - a);
  return Math.min(amount0 * (sqrtP * b) / (b - sqrtP), amount1 / (sqrtP - a));
}

export function sessionAt(ts, intervals) {
  const i = intervals.find((x) => ts >= x.start && ts < x.end);
  return i ? i.phase : 'UNKNOWN';
}
export const sessionIntervals = (start, end) => buildEtMarketIntervals(start - 86400, end + 86400);

const r6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * pool: { role, poolId, liquidity, tickLower, tickUpper, seed: { usdg, nvda } (raw), usdgIsCurrency0, initSqrtPriceX96 }
 * swaps: decoded Swap events in the window, oldest first, each with ts (unix seconds), ref (USDG per NVDA) and from (tx sender)
 * opts: { decimals: { usdg, nvda }, startRef, endRef, endSqrtPriceX96?, botAddresses: [] }
 */
export function computePool(pool, swaps, opts) {
  const dU = 10 ** (opts.decimals?.usdg ?? 6); const dN = 10 ** (opts.decimals?.nvda ?? 18);
  const L = Number(pool.liquidity);
  const seedU = Number(pool.seed.usdg) / dU; const seedN = Number(pool.seed.nvda) / dN;
  const intervals = sessionIntervals(swaps[0]?.ts ?? opts.windowStart, swaps.at(-1)?.ts ?? opts.windowEnd);
  const bots = new Set((opts.botAddresses ?? []).map((a) => a.toLowerCase()));
  const sessions = {}; const rows = []; const series = [];
  let feeU = 0; let feeN = 0; let lvr = 0; let volume = 0;
  const bucket = (name) => (sessions[name] ??= { swaps: 0, volume: 0, fees: 0, lvr: 0, organicSwaps: 0, botSwaps: 0 });

  for (const s of swaps) {
    const dUsdg = Number(pool.usdgIsCurrency0 ? s.amount0 : s.amount1) / dU;
    const dNvda = Number(pool.usdgIsCurrency0 ? s.amount1 : s.amount0) / dN;
    const inUsdg = dUsdg < 0;
    const rate = s.fee / 1e6;
    const gross = inUsdg ? -dUsdg : -dNvda;
    const fee = gross * rate;
    const inRange = s.tick >= pool.tickLower && s.tick < pool.tickUpper;
    const share = inRange && s.liquidity > 0n ? Math.min(1, L / Number(s.liquidity)) : 0;
    const execPrice = inUsdg ? (gross - fee) / dNvda : dUsdg / (gross - fee); // USDG per NVDA, with the fee taken out
    const swapperNvda = inUsdg ? dNvda : -(gross - fee);
    const loss = (s.ref - execPrice) * swapperNvda * share; // what the LP gave up against the reference price, in USDG
    const feeUsdgValue = (inUsdg ? fee : fee * s.ref) * share;
    if (inUsdg) feeU += fee * share; else feeN += fee * share;
    lvr += loss; volume += Math.abs(dUsdg);
    const session = sessionAt(s.ts, intervals);
    const isBot = bots.has(String(s.from ?? '').toLowerCase());
    const b = bucket(session);
    b.swaps += 1; b.volume += Math.abs(dUsdg); b.fees += feeUsdgValue; b.lvr += loss; if (isBot) b.botSwaps += 1; else b.organicSwaps += 1;
    const sqrtP = Number(s.sqrtPriceX96) / Q96;
    const held = positionAmounts(L, sqrtP, pool.tickLower, pool.tickUpper);
    const posValue = held.amount0 / (pool.usdgIsCurrency0 ? dU : dN) * (pool.usdgIsCurrency0 ? 1 : s.ref)
      + held.amount1 / (pool.usdgIsCurrency0 ? dN : dU) * (pool.usdgIsCurrency0 ? s.ref : 1);
    series.push({ ts: s.ts, net: r6(posValue + feeU + feeN * s.ref - (seedU + seedN * s.ref)) });
    rows.push({ tx: s.tx, block: s.block, ts: s.ts, session, feePips: s.fee, from: s.from ?? null, kind: isBot ? 'bot' : 'organic', inToken: inUsdg ? 'USDG' : 'NVDA', in: r6(gross), execPrice: r6(execPrice), ref: r6(s.ref), lvr: r6(loss), fee: r6(feeUsdgValue) });
  }

  const endSqrt = swaps.length ? Number(swaps.at(-1).sqrtPriceX96) / Q96 : Number(pool.initSqrtPriceX96) / Q96;
  const end = positionAmounts(L, endSqrt, pool.tickLower, pool.tickUpper);
  const endU = (pool.usdgIsCurrency0 ? end.amount0 : end.amount1) / dU;
  const endN = (pool.usdgIsCurrency0 ? end.amount1 : end.amount0) / dN;
  const valuePosition = endU + endN * opts.endRef + feeU + feeN * opts.endRef;
  const valueHold = seedU + seedN * opts.endRef;
  const startCapital = seedU + seedN * opts.startRef;
  const net = valuePosition - valueHold;
  for (const k of Object.keys(sessions)) for (const f of ['volume', 'fees', 'lvr']) sessions[k][f] = r6(sessions[k][f]);
  return {
    role: pool.role, poolId: pool.poolId, startCapital: r6(startCapital),
    feesEarned: r6(feeU + feeN * opts.endRef), lvr: r6(lvr), valueVsHold: r6(net), netBps: r6(net / startCapital * 1e4),
    positionValueEnd: r6(valuePosition), holdValueEnd: r6(valueHold),
    swaps: rows.length, volume: r6(volume), organicSwaps: rows.filter((r) => r.kind === 'organic').length, botSwaps: rows.filter((r) => r.kind === 'bot').length,
    sessions, series, rows,
  };
}

/** The headline: the gap between the two pools in bps of capital. Positive means BELL ended ahead. */
export function compare(bell, control) {
  const gapBps = r6(bell.netBps - control.netBps);
  return { gapBps, winner: gapBps > 0 ? 'BELL' : gapBps < 0 ? 'CONTROL' : 'TIE' };
}
