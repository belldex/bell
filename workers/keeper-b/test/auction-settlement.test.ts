import { describe, expect, it } from 'vitest';
import { eligibleAuctions } from '../src/auction-settlement.mjs';
import { settleBellAuctions } from '../src/index.ts';

const pool = (id: string) => ({ hook: `0x${id.padStart(40, '0')}`, poolId: `0x${id.padStart(64, '0')}` });
const addr = (id: string) => `0x${id.padStart(40, '0')}`;

describe('auction settlement selection', () => {
  it('selects only locked, due, active auctions before refund timeout', () => {
    const pools = [pool('1'), pool('2'), pool('3'), pool('4')];
    const registry = {
      [pools[0].poolId]: { address: addr('a'), stage: 3, blocksSwaps: true, openTime: 1_000, cycleDeadline: 1_900 },
      [pools[1].poolId]: { address: addr('b'), stage: 2, blocksSwaps: true, openTime: 1_000, cycleDeadline: 1_900 },
      [pools[2].poolId]: { address: addr('c'), stage: 3, blocksSwaps: true, openTime: 2_000, cycleDeadline: 2_900 },
      [pools[3].poolId]: { address: addr('d'), stage: 3, blocksSwaps: false, openTime: 1_000, cycleDeadline: 1_900 },
    };

    const result = eligibleAuctions(pools, registry, 1_500);

    expect(result.map((item) => item.auction)).toEqual([addr('a')]);
  });

  it('does not settle after timeout, after settlement, or when swaps are not locked', () => {
    const p = pool('a');
    const registry = {
      [p.poolId]: { address: addr('1'), stage: 3, blocksSwaps: true, openTime: 1_000, cycleDeadline: 1_900 },
    };
    expect(eligibleAuctions([p], registry, 1_900)).toEqual([]);
    registry[p.poolId].stage = 4;
    expect(eligibleAuctions([p], registry, 1_500)).toEqual([]);
    registry[p.poolId].stage = 3;
    registry[p.poolId].blocksSwaps = false;
    expect(eligibleAuctions([p], registry, 1_500)).toEqual([]);
  });

  it('ignores unbound and zero-address auctions', () => {
    const a = pool('a');
    const b = pool('b');
    const registry = {
      [a.poolId]: { address: addr('0'), stage: 3, blocksSwaps: true, openTime: 1_000, cycleDeadline: 1_900 },
    };
    expect(eligibleAuctions([a, b], registry, 1_500)).toEqual([]);
  });

  it('simulates a due auction at the pool price and only then submits it', async () => {
    const hook = addr('5');
    const auction = addr('6');
    const pool = { hook, poolId: `0x${'7'.repeat(64)}`, poolManager: addr('8') };
    const publicClient = {
      getChainId: async () => 4663,
      readContract: async ({ functionName }: any) => {
        if (functionName === 'auctionFor') return auction;
        if (functionName === 'currentStage') return 3;
        if (functionName === 'blocksSwaps') return true;
        if (functionName === 'openTime') return 1_000n;
        if (functionName === 'cycleDeadline') return 1_900n;
        if (functionName === 'cycleId') return 7n;
        throw new Error(`unexpected read ${functionName}`);
      },
      simulateContract: async (request: any) => ({ request, result: request.functionName === 'armNext' ? false : undefined }),
      waitForTransactionReceipt: async () => ({ status: 'success' }),
    };
    const walletClient = { writeContract: async () => '0xsettled' };

    const result = await settleBellAuctions({
      BELL_AUCTION_REGISTRY: addr('9'),
      BELL_TRANSACTION_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      RH_MAINNET_RPC_PRIMARY: 'https://rpc.invalid',
      BELL_EXPECTED_CHAIN_ID: '4663',
    }, {
      nowSeconds: 1_500,
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      fetchPools: async () => ({ pools: [pool] }),
    });

    expect(result).toMatchObject({ status: 'settled', eligibleCount: 1 });
    expect(result.results[0]).toMatchObject({ status: 'settled', txHash: '0xsettled', hook, cycleId: 7 });
  });

  it('never broadcasts when the auction rejects the proposed pool price', async () => {
    const auction = addr('6');
    const pool = { hook: addr('5'), poolId: `0x${'7'.repeat(64)}`, poolManager: addr('8') };
    const writes: unknown[] = [];
    const publicClient = {
      getChainId: async () => 4663,
      readContract: async ({ functionName }: any) => {
        if (functionName === 'auctionFor') return auction;
        if (functionName === 'currentStage') return 3;
        if (functionName === 'blocksSwaps') return true;
        if (functionName === 'openTime') return 1_000n;
        if (functionName === 'cycleDeadline') return 1_900n;
        if (functionName === 'cycleId') return 7n;
        throw new Error(`unexpected read ${functionName}`);
      },
      simulateContract: async (request: any) => {
        if (request.functionName === 'armNext') return { request, result: false };
        throw new Error('EscrowInvariant');
      },
      waitForTransactionReceipt: async () => ({ status: 'success' }),
    };
    const walletClient = { writeContract: async (request: unknown) => { writes.push(request); return '0xshould-not-send'; } };

    const result = await settleBellAuctions({
      BELL_AUCTION_REGISTRY: addr('9'),
      BELL_TRANSACTION_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      RH_MAINNET_RPC_PRIMARY: 'https://rpc.invalid',
      BELL_EXPECTED_CHAIN_ID: '4663',
    }, {
      nowSeconds: 1_500,
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      fetchPools: async () => ({ pools: [pool] }),
    });

    expect(result.status).toBe('idle');
    expect(result.results[0]).toMatchObject({ status: 'not-settled', reason: expect.stringContaining('EscrowInvariant') });
    expect(writes).toEqual([]);
  });

  it('finalizes an expired cycle as refunded before attempting to arm the next cycle', async () => {
    const auction = addr('6');
    const pool = { hook: addr('5'), poolId: `0x${'7'.repeat(64)}`, poolManager: addr('8') };
    const calls: string[] = [];
    const writes: string[] = [];
    const publicClient = {
      getChainId: async () => 4663,
      readContract: async ({ functionName }: any) => {
        if (functionName === 'auctionFor') return auction;
        if (functionName === 'currentStage') return 5;
        if (functionName === 'blocksSwaps') return false;
        if (functionName === 'openTime') return 1_000n;
        if (functionName === 'cycleDeadline') return 1_900n;
        if (functionName === 'cycleId') return 7n;
        throw new Error(`unexpected read ${functionName}`);
      },
      simulateContract: async (request: any) => { calls.push(request.functionName); return { request, result: request.functionName === 'armNext' }; },
      waitForTransactionReceipt: async () => ({ status: 'success' }),
    };
    const walletClient = { writeContract: async (request: any) => { writes.push(request.functionName); return `0x${request.functionName}`; } };

    const result = await settleBellAuctions({
      BELL_AUCTION_REGISTRY: addr('9'),
      BELL_TRANSACTION_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      RH_MAINNET_RPC_PRIMARY: 'https://rpc.invalid',
      BELL_EXPECTED_CHAIN_ID: '4663',
    }, {
      nowSeconds: 1_900,
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      fetchPools: async () => ({ pools: [pool] }),
    });

    expect(calls.slice(0, 2)).toEqual(['refund', 'armNext']);
    expect(writes).toEqual(['refund', 'armNext']);
    expect(result.status).toBe('idle');
  });
});
