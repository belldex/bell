/**
 * Reads what the v3 Evolve run needs from a public RPC: Swap events, the Chainlink NVDA feed at any block, and block times.
 * buildRun() is used by both the builder and the replay script, so the page and the check can never use different code.
 */
import { SWAP_TOPIC, decodeSwap, computePool, compare, sessionIntervals } from './lib.mjs';

export const FEED_MAX_AGE = 6 * 3600; // a feed round older than this is stale; swaps then use the next fresh round
const hex = (n) => `0x${n.toString(16)}`;
const ROUND_DATA = '0xfeaf968c'; // latestRoundData()

export async function head(rpc) { return parseInt(await rpc('eth_blockNumber', []), 16); }
export async function blockTime(rpc, block) { return parseInt((await rpc('eth_getBlockByNumber', [hex(block), false])).timestamp, 16); }

/** Last block with a timestamp at or before ts. */
export async function blockAtOrBefore(rpc, ts, hi) {
  let lo = 1; let top = hi ?? await head(rpc);
  while (lo < top) {
    const mid = Math.floor((lo + top + 1) / 2);
    if (await blockTime(rpc, mid) <= ts) lo = mid; else top = mid - 1;
  }
  return lo;
}

export async function feedAt(rpc, feed, block) {
  const out = await rpc('eth_call', [{ to: feed, data: ROUND_DATA }, hex(block)]);
  const w = (i) => BigInt(`0x${out.slice(2 + i * 64, 2 + (i + 1) * 64)}`);
  return { roundId: w(0).toString(), price: Number(w(1)) / 1e8, updatedAt: Number(w(3)) };
}

/** First block where the feed's updatedAt is later than ts, and the round at that block. */
export async function firstUpdateAfter(rpc, feed, ts, lo, hi) {
  let a = lo; let b = hi;
  if ((await feedAt(rpc, feed, b)).updatedAt <= ts) return null;
  while (a < b) {
    const mid = Math.floor((a + b) / 2);
    if ((await feedAt(rpc, feed, mid)).updatedAt > ts) b = mid; else a = mid + 1;
  }
  return { block: a, ...(await feedAt(rpc, feed, a)) };
}

export async function getSwaps(rpc, poolManager, poolId, from, to) {
  const logs = [];
  let step = 200_000;
  for (let start = from; start <= to;) {
    const end = Math.min(to, start + step - 1);
    try {
      logs.push(...await rpc('eth_getLogs', [{ address: poolManager, topics: [SWAP_TOPIC, poolId], fromBlock: hex(start), toBlock: hex(end) }]));
      start = end + 1;
    } catch (e) {
      if (step <= 2_000) throw e;
      step = Math.floor(step / 4);
    }
  }
  return logs.map((l) => ({ ...decodeSwap(l), ts: l.blockTimestamp ? parseInt(l.blockTimestamp, 16) : null }));
}

export async function buildRun(cfg, rpc) {
  const { chain, window: win } = cfg;
  const headBlock = await head(rpc);
  const startBlock = cfg.blocks?.start ?? await blockAtOrBefore(rpc, win.startTs, headBlock);
  const endBlock = cfg.blocks?.end ?? await blockAtOrBefore(rpc, win.endTs, headBlock);
  const startRound = await feedAt(rpc, chain.feed, startBlock);
  const endRound = await feedAt(rpc, chain.feed, endBlock);
  const tsOf = new Map(); const fromOf = new Map(); const refOf = new Map();
  const bell = cfg.pools.bell; const control = cfg.pools.control;
  const pools = {};
  for (const [name, pool] of Object.entries({ bell, control })) {
    const swaps = await getSwaps(rpc, chain.poolManager, pool.poolId, Math.max(pool.seedBlock, startBlock), endBlock);
    for (const s of swaps) {
      if (s.ts == null) { if (!tsOf.has(s.block)) tsOf.set(s.block, await blockTime(rpc, s.block)); s.ts = tsOf.get(s.block); }
      if (!fromOf.has(s.tx)) fromOf.set(s.tx, (await rpc('eth_getTransactionByHash', [s.tx])).from);
      s.from = fromOf.get(s.tx);
      const round = await feedAt(rpc, chain.feed, s.block);
      if (s.ts - round.updatedAt <= FEED_MAX_AGE) { s.ref = round.price; s.refKind = 'live'; }
      else {
        const key = `after:${round.updatedAt}`;
        if (!refOf.has(key)) refOf.set(key, await firstUpdateAfter(rpc, chain.feed, s.ts, s.block, endBlock));
        const next = refOf.get(key);
        // No fresh round yet (the run is live over a weekend): leave the swap out of LVR for now and say so.
        if (!next) { s.ref = null; s.refKind = 'pending'; } else { s.ref = next.price; s.refKind = 'reopen'; s.refRound = next.roundId; }
      }
    }
    pools[name] = swaps;
  }
  const opts = { decimals: cfg.decimals, startRef: startRound.price, endRef: endRound.price, botAddresses: cfg.bot?.addresses ?? [], windowStart: win.startTs, windowEnd: win.endTs };
  const pendingRefs = Object.values(pools).flat().filter((s) => s.ref == null).length;
  const usable = (arr) => arr.filter((s) => s.ref != null);
  const outBell = computePool({ ...bell, role: 'bell' }, usable(pools.bell), opts);
  const outControl = computePool({ ...control, role: 'control' }, usable(pools.control), opts);
  return {
    blocks: { start: startBlock, end: endBlock, head: headBlock },
    reference: {
      rule: 'Live feed round when it is at most 6 hours old at the swap; otherwise the first feed round published after the swap. Window start and end use the feed at those blocks.',
      start: { block: startBlock, ...startRound }, end: { block: endBlock, ...endRound, fresh: win.endTs - endRound.updatedAt <= FEED_MAX_AGE },
    },
    pendingReferences: pendingRefs,
    bell: outBell, control: outControl, verdict: compare(outBell, outControl), bands: sessionIntervals(win.startTs, win.endTs).filter((i) => i.end > win.startTs && i.start < win.endTs).map((i) => ({ phase: i.phase, start: Math.max(i.start, win.startTs), end: Math.min(i.end, win.endTs) })),
  };
}
