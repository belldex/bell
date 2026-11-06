import { describe, expect, it } from 'vitest';
import { readAuctionSnapshots } from '../src/auction-read.mjs';

const ZERO = '0x0000000000000000000000000000000000000000';
const registry = '0x00000000000000000000000000000000000000aa';
const auctionAddr = '0x00000000000000000000000000000000000000bb';
const pools = [{ poolId: '0x' + '1'.repeat(64) }, { poolId: '0x' + '2'.repeat(64) }];

// A fake chain client: multicall answers by function name from a plain state object.
function fakeClient(state: Record<string, any>) {
  const calls: any[] = [];
  const batchSizes: number[] = [];
  return {
    calls,
    batchSizes,
    multicall: async ({ contracts, batchSize }: { contracts: any[]; batchSize?: number }) => {
      calls.push(contracts.length);
      if (batchSize !== undefined) batchSizes.push(batchSize);
      return contracts.map((c) => {
        const v = state[c.functionName];
        return typeof v === 'function' ? v(c.args) : v;
      });
    },
  };
}

const baseState = () => ({
  auctionFor: ([id]: string[]) => (id === pools[0].poolId ? auctionAddr : ZERO),
  currentStage: 2, blocksSwaps: true, orderCount: 1, openTime: 5000n, auctionLead: 600, settleTimeout: 900, cycleId: 3n,
  indicativeClearing: [1n << 96n, 7n],
  cycleOrderCount: 1,
  cycleSummary: [5000n, 5900n, 2, 0n, 0n, false],
  cycleOrderId: 4,
  order: { owner: '0x00000000000000000000000000000000000000cc', amountIn: 10n, limitPriceX96: 99n, cycleId: 3n, isBuyer: true, cancelled: false, claimed: false },
  allocation: [1n, 2n, 3n],
});

describe('auction read snapshots', () => {
  it('returns bound auctions keyed by pool id with JSON-safe values', async () => {
    const client = fakeClient(baseState());
    const out = await readAuctionSnapshots(client, { registry, pools });
    const snap = out[pools[0].poolId];
    expect(Object.keys(out)).toEqual([pools[0].poolId]);
    expect(snap).toMatchObject({ address: auctionAddr, stage: 2, blocksSwaps: true, cycleId: 3, openTime: 5000, auctionLead: 600, settleTimeout: 900, cycleFinalized: false });
    expect(snap.priceX96).toBe((1n << 96n).toString());
    expect(snap.matchedBase).toBe('7');
    expect(snap.orders).toEqual([{ id: 4, owner: '0x00000000000000000000000000000000000000cc', isBuyer: true, amountIn: '10', limitPriceX96: '99', fillBase: '1', quotePayout: '2', quoteRefund: '3', cancelled: false, claimed: false }]);
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('uses the settled summary instead of the indicative price once a cycle is final', async () => {
    const state = { ...baseState(), cycleSummary: [5000n, 5900n, 4, 123n, 9n, true] };
    const out = await readAuctionSnapshots(fakeClient(state), { registry, pools });
    expect(out[pools[0].poolId]).toMatchObject({ cycleFinalized: true, priceX96: '123', matchedBase: '9' });
  });

  it('batches reads: the number of multicalls does not grow with the order count', async () => {
    const few = fakeClient({ ...baseState(), cycleOrderCount: 1 });
    const many = fakeClient({ ...baseState(), cycleOrderCount: 25 });
    await readAuctionSnapshots(few, { registry, pools });
    await readAuctionSnapshots(many, { registry, pools });
    expect(many.calls.length).toBe(few.calls.length);
    expect(many.calls.length).toBeLessThanOrEqual(8);
    expect(many.batchSizes).toContain(64_000);
  });

  it('keeps directory multicalls bounded as the number of bound pools grows', async () => {
    const manyPools = Array.from({ length: 10 }, (_, i) => ({ poolId: `0x${(i + 10).toString(16).padStart(64, '0')}` }));
    const client = fakeClient({
      ...baseState(),
      auctionFor: () => auctionAddr,
      cycleOrderCount: 25,
      cycleOrderId: ([, index]: [bigint, number]) => index,
    });

    await readAuctionSnapshots(client, { registry, pools: manyPools });

    expect(client.calls.length).toBeLessThanOrEqual(8);
  });

  it('returns an empty map when no pool has a bound auction', async () => {
    const state = { ...baseState(), auctionFor: ZERO };
    expect(await readAuctionSnapshots(fakeClient(state), { registry, pools })).toEqual({});
  });

  it('reads a historical cycle only for an auction the registry actually bound', async () => {
    const client = fakeClient(baseState());
    const cycle = await readAuctionSnapshots(client, { registry, pools, auction: auctionAddr, cycle: 2 });
    expect(cycle).toMatchObject({ openTime: 5000, stage: 2, finalized: false });
    await expect(readAuctionSnapshots(client, { registry, pools, auction: '0x00000000000000000000000000000000000000dd', cycle: 2 }))
      .rejects.toThrow(/not a bound auction/i);
  });
});
