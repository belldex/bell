import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ chainId: 4663, reads: [] as any[] }));
vi.mock('viem', async (original) => ({
  ...await original(),
  createPublicClient: () => ({
    getChainId: async () => state.chainId,
    getBlockNumber: async () => 100n,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, timestamp: 1_800_000_000n }),
    readContract: async (request) => {
      state.reads.push(request);
      if (request.functionName === 'getPoolInfo') return ['0x1111111111111111111111111111111111111111', 0x2cc0, true, '0x2222222222222222222222222222222222222222'];
      if (request.functionName === 'getSwapStatus') return {
        allowed: false, reason: '0x12345678', session: 5, currentFeePips: 10000,
        maxIn0: 123n, maxIn1: 456n, auctionWindow: true, nextTransition: 1_800_000_600n,
      };
      throw new Error(`Unexpected Lens function ${request.functionName}`);
    },
  }),
}));

const { default: worker } = await import('../src/index');
const POOL = `0x${'ab'.repeat(32)}`;
const LENS = '0x3333333333333333333333333333333333333333';
const env = { BELL_SWAP_LENS_MAP: JSON.stringify({ [POOL]: LENS }), RH_MAINNET_RPC_PRIMARY: 'https://rpc.test' };

describe('public pool status endpoint', () => {
  beforeEach(() => { state.reads = []; state.chainId = 4663; });

  it('returns pool info and exact-input status pinned to one observed block', async () => {
    const response = await worker.fetch(new Request(`https://keeper.test/pools/${POOL}/status?zeroForOne=true&amountIn=123`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(body).toMatchObject({
      chainId: 4663, poolId: POOL, lens: LENS,
      hook: '0x1111111111111111111111111111111111111111', hookFlags: '0x2cc0',
      hasAuction: true, auction: '0x2222222222222222222222222222222222222222',
      request: { zeroForOne: true, amountIn: '123' },
      status: { allowed: false, reason: '0x12345678', session: 5, currentFeePips: 10000, maxIn0: '123', maxIn1: '456', auctionWindow: true, nextTransition: '1800000600' },
      blockNumber: '100',
    });
    expect(state.reads).toHaveLength(2);
    expect(state.reads.every((read) => read.blockNumber === 100n)).toBe(true);
  });

  it('validates malformed IDs and parameters before making RPC reads', async () => {
    const badId = await worker.fetch(new Request('https://keeper.test/pools/nope/status?zeroForOne=true&amountIn=1'), env);
    expect(badId.status).toBe(400);
    const badAmount = await worker.fetch(new Request(`https://keeper.test/pools/${POOL}/status?zeroForOne=1&amountIn=-1`), env);
    expect(badAmount.status).toBe(400);
    expect(state.reads).toHaveLength(0);
  });

  it('does not return fabricated status when a pool has no deployed Lens', async () => {
    const response = await worker.fetch(new Request(`https://keeper.test/pools/${POOL}/status?zeroForOne=false&amountIn=1`), { ...env, BELL_SWAP_LENS_MAP: '{}' });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'No deployed Lens is registered for this pool' });
    expect(state.reads).toHaveLength(0);
  });
});
