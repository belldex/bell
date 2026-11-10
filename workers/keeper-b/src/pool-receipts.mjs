import { decodeEventLog, parseAbi, toEventSelector, toHex } from 'viem';

const POOL_EVENTS = parseAbi([
  'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
  'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
]);
const AUCTION_EVENTS = parseAbi([
  'event CycleArmed(uint64 indexed cycleId,uint64 openTime,bytes32 closedLeafHash,bytes32 openLeafHash)',
  'event OrderSubmitted(uint64 indexed cycleId,uint32 indexed orderId,address indexed owner,bool isBuyer,uint128 amountIn,uint160 limitPriceX96)',
  'event OrderCancelled(uint64 indexed cycleId,uint32 indexed orderId,address indexed owner)',
  'event CycleSettled(uint64 indexed cycleId,uint160 clearingPriceX96,uint128 matchedBase,uint32 filledOrders)',
  'event CycleRefunded(uint64 indexed cycleId)',
  'event UnfilledClaimed(uint64 indexed cycleId,uint32 indexed orderId,address indexed owner,uint128 quoteRefund,uint128 baseRefund)',
]);
const REGISTRY_ABI = parseAbi(['function auctionFor(bytes32 poolId) view returns (address)']);
const ZERO = `0x${'0'.repeat(40)}`;
const MAX_BLOCKS = 10_000n;
const MAX_LOGS = 2_000;
const error = (message, status = 400) => Object.assign(new Error(message), { status, receiptValidation: status === 400 });
const encodeCursor = value => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/**
 * Bounded, on-demand receipt index. Each cursor freezes the head and a <=10k-block window.
 * Pages within a window share a five-minute Cache API entry (at most 2k events); the next
 * cursor moves backwards, including empty windows. Dense windows are halved until they fit;
 * continuation starts immediately before that smaller window so no receipts are skipped. A
 * single block above the event budget fails explicitly. At most 15 attempts / 30 log requests
 * are needed for a 10k-block window, keeping the route within the 50-subrequest ceiling.
 * No Durable Object history grows with
 * swaps. Cache eviction only causes that bounded window to be scanned again. Values and block
 * numbers are decimal strings where the ABI uses bigint; fee/logIndex are JSON numbers.
 */
export async function readPoolReceipts({ client, pool, auctionRegistry, expectedChainId = 4663, limit = '50', cursor = null, readCache = async () => null, writeCache = async () => {} }) {
  const poolId = pool.poolId.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(poolId)) throw error('Invalid pool ID');
  if (!/^\d+$/.test(String(limit)) || Number(limit) < 1) throw error('Invalid page size');
  const pageSize = Math.min(100, Number(limit));
  const genesis = BigInt(pool.createdAtBlock);
  let state = null;
  if (cursor !== null) {
    try {
      if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      state = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')));
      if (state.v !== 2 || state.poolId !== poolId || !['snapshot', 'from', 'to'].every(k => /^\d{1,20}$/.test(state[k]))
        || !Number.isSafeInteger(state.offset) || state.offset < 0 || state.offset > MAX_LOGS) throw new Error();
      if (BigInt(state.from) < genesis || BigInt(state.to) < BigInt(state.from) || BigInt(state.to) > BigInt(state.snapshot)
        || BigInt(state.to) - BigInt(state.from) >= MAX_BLOCKS) throw new Error();
    } catch { throw error('Invalid receipt cursor'); }
  }
  const chainId = await client.getChainId();
  if (chainId !== expectedChainId) throw error('Receipt chain unavailable', 503);
  const head = await client.getBlockNumber();
  const snapshot = state ? BigInt(state.snapshot) : head;
  if (snapshot > head) throw error('Invalid receipt cursor');
  let to = state ? BigInt(state.to) : snapshot;
  let from = state ? BigInt(state.from) : (to - genesis >= MAX_BLOCKS ? to - MAX_BLOCKS + 1n : genesis);
  const offset = state?.offset ?? 0;
  const auction = auctionRegistry ? await client.readContract({ address: auctionRegistry, abi: REGISTRY_ABI, functionName: 'auctionFor', args: [poolId], blockNumber: snapshot }) : ZERO;
  const cacheKey = () => `${chainId}/${poolId}/${pool.poolManager.toLowerCase()}/${auction.toLowerCase()}/${from}/${to}`;
  let receipts = await readCache(cacheKey());
  if (!receipts) {
    receipts = [];
    if (from <= to) {
      const sources = [{ address: pool.poolManager, abi: POOL_EVENTS, topics: [POOL_EVENTS.map(toEventSelector), poolId] }];
      if (auction.toLowerCase() !== ZERO) sources.push({ address: auction, abi: AUCTION_EVENTS, topics: [AUCTION_EVENTS.map(toEventSelector)] });
      while (true) {
        receipts = [];
        let oversized = false;
        for (const source of sources) {
          const logs = await client.request({ method: 'eth_getLogs', params: [{ address: source.address, fromBlock: toHex(from), toBlock: toHex(to), topics: source.topics }] });
          if (!Array.isArray(logs)) throw error('Malformed receipt logs', 503);
          if (logs.length + receipts.length > MAX_LOGS) { oversized = true; break; }
          for (const log of logs) {
            if (log.removed) continue;
            const decoded = decodeEventLog({ abi: source.abi, data: log.data, topics: log.topics, strict: true });
            if (decoded.args.id && decoded.args.id.toLowerCase() !== poolId) continue;
            const args = JSON.parse(JSON.stringify(decoded.args, (_k, value) => typeof value === 'bigint' ? String(value) : value));
            receipts.push({ event: decoded.eventName, poolId, address: source.address, blockNumber: String(BigInt(log.blockNumber)), blockHash: log.blockHash,
              transactionHash: log.transactionHash, logIndex: Number(BigInt(log.logIndex)), args,
              ...(decoded.eventName === 'Swap' ? { fee: Number(decoded.args.fee) } : {}),
              explorerUrl: `https://robinhoodchain.blockscout.com/tx/${log.transactionHash}` });
          }
        }
        if (!oversized) break;
        // An already-issued offset belongs to the original window. A reorg or changed RPC
        // result must not silently reinterpret it against a newly shortened window.
        if (from === to || offset > 0) throw error('Receipt block exceeds safe capacity', 503);
        from = from + (to - from + 1n) / 2n;
      }
      receipts.sort((a, b) => BigInt(a.blockNumber) < BigInt(b.blockNumber) ? 1 : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : b.logIndex - a.logIndex);
      receipts = [...new Map(receipts.map(row => [`${row.transactionHash}:${row.logIndex}`, row])).values()];
    }
    await writeCache(cacheKey(), receipts);
  }
  if (offset > receipts.length) throw error('Invalid receipt cursor');
  const page = receipts.slice(offset, offset + pageSize);
  const hasMoreRows = offset + page.length < receipts.length;
  const hasMoreBlocks = from > genesis;
  const nextTo = from - 1n;
  const nextFrom = nextTo - genesis >= MAX_BLOCKS ? nextTo - MAX_BLOCKS + 1n : genesis;
  const nextCursor = hasMoreRows || hasMoreBlocks ? encodeCursor({ v: 2, poolId, snapshot: String(snapshot), from: String(hasMoreRows ? from : nextFrom),
    to: String(hasMoreRows ? to : nextTo), offset: hasMoreRows ? offset + page.length : 0 }) : null;
  return { version: 1, chainId, poolId, blockNumber: String(snapshot), observedAt: new Date().toISOString(), limit: pageSize,
    range: { fromBlock: String(from), toBlock: String(to) }, receipts: page, nextCursor, complete: nextCursor === null };
}
