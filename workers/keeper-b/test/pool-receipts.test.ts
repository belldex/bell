import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import worker from '../src/index';
import { readPoolReceipts } from '../src/pool-receipts.mjs';
const poolId = `0x${'11'.repeat(32)}`;
const manager = `0x${'22'.repeat(20)}`;
const auction = `0x${'33'.repeat(20)}`;
const tx = `0x${'44'.repeat(32)}`;
const hash = `0x${'55'.repeat(32)}`;
const pool = { poolId, poolManager: manager, createdAtBlock: '100' };
function log(event: string, args: any, values: any[], block: number, index: number, address = manager) {
  const item = parseAbiItem(event);
  return { address, topics: encodeEventTopics({ abi: [item], eventName: item.name, args }), data: encodeAbiParameters(item.inputs.filter(x => !x.indexed), values), blockNumber: `0x${block.toString(16)}`, logIndex: `0x${index.toString(16)}`, transactionHash: tx, blockHash: hash };
}
function client(logs: any[], head = 105n) {
  const ranges: any[] = [];
  return { ranges, getChainId: async () => 4663, getBlockNumber: async () => head,
    readContract: async () => auction,
    request: async ({ params: [filter] }: any) => { ranges.push(filter); return logs.filter(x => x.address === filter.address && BigInt(x.blockNumber) >= BigInt(filter.fromBlock) && BigInt(x.blockNumber) <= BigInt(filter.toBlock)); } };
}
const initialize = () => log('event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)', { id: poolId, currency0: manager, currency1: auction }, [500, 60, auction, 123n, 1], 100, 1);
const swap = () => log('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)', { id: poolId, sender: manager }, [-10n, 9n, 123n, 456n, 1, 3000], 101, 2);
const settled = () => log('event CycleSettled(uint64 indexed cycleId,uint160 clearingPriceX96,uint128 matchedBase,uint32 filledOrders)', { cycleId: 2n }, [123n, 9n, 1], 102, 3, auction);
describe('public pool receipt pages', () => {
  it('normalizes Initialize, Swap fee and auction values with source identifiers', async () => {
    const out = await readPoolReceipts({ client: client([settled(), swap(), initialize()]), pool, auctionRegistry: manager });
    expect(out.receipts.map(x => x.event)).toEqual(['Initialize', 'Swap', 'CycleSettled']);
    expect(out.receipts[1]).toMatchObject({ poolId, blockNumber: '101', blockHash: hash, transactionHash: tx, logIndex: 2, fee: 3000, args: { amount0: '-10', amount1: '9' }, explorerUrl: `https://robinhoodchain.blockscout.com/tx/${tx}` });
    expect(() => JSON.stringify(out)).not.toThrow();
  });
  it('paginates a pinned chronological snapshot without duplicates', async () => {
    const first = await readPoolReceipts({ client: client([swap(), initialize()]), pool, limit: '1' });
    const second = await readPoolReceipts({ client: client([swap(), initialize(), settled()], 999n), pool, limit: '1', cursor: first.nextCursor });
    expect(first.receipts.map(x => x.event)).toEqual(['Initialize']);
    expect(second.receipts.map(x => x.event)).toEqual(['Swap']);
    expect(second.blockNumber).toBe('105');
    expect(second.nextCursor).toBeNull();
  });
  it('bounds cold scans and offers a continuation even for empty windows', async () => {
    const chain = client([], 999999n);
    const out = await readPoolReceipts({ client: chain, pool, limit: '9999' });
    expect(out.limit).toBe(100);
    expect(chain.ranges.every(x => BigInt(x.toBlock) - BigInt(x.fromBlock) < 10000n)).toBe(true);
    expect(out.nextCursor).toBeTruthy();
    expect(out.complete).toBe(false);
  });
  it('reuses cached decoded windows between pages', async () => {
    const cache = new Map();
    const readCache = async key => cache.get(key);
    const writeCache = async (key, value) => { cache.set(key, value); };
    const chain = client([initialize(), swap()]);
    const first = await readPoolReceipts({ client: chain, pool, limit: '1', readCache, writeCache });
    chain.ranges.length = 0;
    const second = await readPoolReceipts({ client: chain, pool, cursor: first.nextCursor, readCache, writeCache });
    expect(second.receipts.map(x => x.event)).toEqual(['Swap']);
    expect(chain.ranges).toEqual([]);
  });
  it('fails explicitly instead of silently dropping an oversized RPC window', async () => {
    const logs = Array.from({ length: 2001 }, (_, i) => ({ ...swap(), logIndex: `0x${i.toString(16)}` }));
    await expect(readPoolReceipts({ client: client(logs), pool })).rejects.toMatchObject({ status: 503 });
  });
  it('rejects invalid or cross-pool cursors', async () => {
    await expect(readPoolReceipts({ client: client([]), pool, cursor: 'garbage' })).rejects.toMatchObject({ status: 400 });
    const first = await readPoolReceipts({ client: client([], 999999n), pool });
    await expect(readPoolReceipts({ client: client([]), pool: { ...pool, poolId: `0x${'77'.repeat(32)}` }, cursor: first.nextCursor })).rejects.toMatchObject({ status: 400 });
  });
  it('rejects an invalid pool id publicly with CORS before reading RPC', async () => {
    const response = await worker.fetch(new Request('https://keeper/pools/bad/receipts'), {});
    expect(response.status).toBe(400);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
  it('sanitizes upstream HTTP 400 errors instead of exposing RPC secrets', async () => {
    const env = { KEEPER_DO: { idFromName: () => 'id', get: () => ({ fetch: async () => { throw Object.assign(new Error('https://rpc.test/private-key-secret'), { status: 400 }); } }) } };
    const response = await worker.fetch(new Request(`https://keeper/pools/${poolId}/receipts`), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Live pool receipts are temporarily unavailable' });
  });
  it('returns 404 for an unknown pool from a current directory cache', async () => {
    const env = { KEEPER_DO: { idFromName: () => 'id', get: () => ({ fetch: async () => Response.json({ static: {}, cursor: '100' }) }) } };
    const response = await worker.fetch(new Request(`https://keeper/pools/${poolId}/receipts`), env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unknown pool' });
  });
});
