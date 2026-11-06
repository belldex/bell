import { parseAbi } from 'viem';

/**
 * Read-only Opening Bell Auction snapshots served by the keeper.
 *
 * Browsers cannot always reach the public Robinhood Chain RPC (an ISP can answer it with its own
 * TLS certificate, which surfaces as "Failed to fetch"). The Worker reaches the chain server-side and
 * returns plain JSON, so the /auction page works without the visitor's browser talking to any RPC.
 * Every read is batched through Multicall3 to stay far inside the Worker subrequest budget.
 */
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const ZERO = '0x0000000000000000000000000000000000000000';

const REGISTRY_ABI = parseAbi(['function auctionFor(bytes32 poolId) view returns (address)']);
const ABI = parseAbi([
  'function currentStage() view returns (uint8)',
  'function blocksSwaps() view returns (bool)',
  'function orderCount() view returns (uint32)',
  'function openTime() view returns (uint64)',
  'function auctionLead() view returns (uint32)',
  'function settleTimeout() view returns (uint32)',
  'function cycleId() view returns (uint64)',
  'function indicativeClearing() view returns (uint160 priceX96,uint128 matchedBase)',
  'function cycleOrderCount(uint64) view returns (uint32)',
  'function cycleSummary(uint64) view returns (uint64 cycleOpenTime,uint64 deadline,uint8 cycleStage,uint160 priceX96,uint128 matchedBase,bool finalized)',
  'function cycleOrderId(uint64,uint32) view returns (uint32)',
  'function order(uint32) view returns ((address owner,uint128 amountIn,uint160 limitPriceX96,uint64 cycleId,bool isBuyer,bool cancelled,bool claimed))',
  'function allocation(uint64,uint32) view returns (uint128 baseFill,uint128 quotePayout,uint128 quoteRefund)',
]);

const batch = (client, contracts) =>
  contracts.length === 0
    ? Promise.resolve([])
    : client.multicall({ contracts, allowFailure: false, multicallAddress: MULTICALL3 });

async function readOrders(client, auction, cycle) {
  const count = Number((await batch(client, [{ address: auction, abi: ABI, functionName: 'cycleOrderCount', args: [BigInt(cycle)] }]))[0]);
  const ids = (await batch(client, Array.from({ length: count }, (_, index) =>
    ({ address: auction, abi: ABI, functionName: 'cycleOrderId', args: [BigInt(cycle), index] })))).map(Number);
  const reads = await batch(client, ids.flatMap((id) => [
    { address: auction, abi: ABI, functionName: 'order', args: [id] },
    { address: auction, abi: ABI, functionName: 'allocation', args: [BigInt(cycle), id] },
  ]));
  return ids.map((id, i) => {
    const order = reads[2 * i];
    const allocation = reads[2 * i + 1];
    return {
      id, owner: order.owner, isBuyer: order.isBuyer, amountIn: String(order.amountIn),
      limitPriceX96: String(order.limitPriceX96), fillBase: String(allocation[0]),
      quotePayout: String(allocation[1]), quoteRefund: String(allocation[2]),
      cancelled: order.cancelled, claimed: order.claimed,
    };
  });
}

/**
 * Without `auction`: a snapshot of every auction bound in the registry, keyed by pool id.
 * With `auction` and `cycle`: that one cycle's summary and orders, but only for an auction the
 * registry has bound, so the endpoint is not an open window onto arbitrary contracts.
 */
export async function readAuctionSnapshots(client, { registry, pools, auction, cycle }) {
  const found = await batch(client, pools.map((pool) =>
    ({ address: registry, abi: REGISTRY_ABI, functionName: 'auctionFor', args: [pool.poolId] })));
  const bound = pools
    .map((pool, i) => ({ poolId: pool.poolId, address: found[i] }))
    .filter((entry) => entry.address && entry.address !== ZERO);

  if (auction !== undefined) {
    const wanted = String(auction).toLowerCase();
    if (!bound.some((entry) => entry.address.toLowerCase() === wanted)) throw new Error('not a bound auction');
    const currentCycle = Number((await batch(client, [{ address: auction, abi: ABI, functionName: 'cycleId' }]))[0]);
    if (!Number.isInteger(cycle) || cycle <= 0 || cycle > currentCycle) throw new Error('cycle out of range');
    const summary = (await batch(client, [{ address: auction, abi: ABI, functionName: 'cycleSummary', args: [BigInt(cycle)] }]))[0];
    return {
      openTime: Number(summary[0]), stage: Number(summary[2]), priceX96: String(summary[3]),
      matchedBase: String(summary[4]), finalized: summary[5], orders: await readOrders(client, auction, cycle),
    };
  }

  const out = {};
  for (const entry of bound) {
    const a = entry.address;
    const one = (functionName) => ({ address: a, abi: ABI, functionName });
    const [stage, blocksSwaps, orderCount, openTime, auctionLead, settleTimeout, cycleId, indicative] = await batch(client, [
      one('currentStage'), one('blocksSwaps'), one('orderCount'), one('openTime'),
      one('auctionLead'), one('settleTimeout'), one('cycleId'), one('indicativeClearing'),
    ]);
    const summary = (await batch(client, [{ address: a, abi: ABI, functionName: 'cycleSummary', args: [cycleId] }]))[0];
    const finalized = summary[5];
    out[entry.poolId] = {
      address: a,
      stage: Number(stage),
      blocksSwaps,
      orderCount: Number(orderCount),
      cycleId: Number(cycleId),
      cycleFinalized: finalized,
      openTime: Number(summary[0] || openTime),
      auctionLead: Number(auctionLead),
      settleTimeout: Number(settleTimeout),
      priceX96: String(finalized ? summary[3] : indicative[0]),
      matchedBase: String(finalized ? summary[4] : indicative[1]),
      orders: await readOrders(client, a, Number(cycleId)),
    };
  }
  return out;
}
