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

  it('reads every pool through batched multicalls so a busy tick stays under the subrequest cap', async () => {
    const auction = addr('6');
    const pools = ['1', '2', '3', '4', '5'].map((id) => ({ hook: addr(id), poolId: `0x${id.repeat(64)}`, poolManager: addr('8') }));
    const batches: number[] = [];
    const publicClient = {
      getChainId: async () => 4663,
      // A per-pool readContract would cost one subrequest each; it must not be used when multicall exists.
      readContract: async () => { throw new Error('per-pool read used'); },
      multicall: async ({ contracts }: any) => {
        batches.push(contracts.length);
        return contracts.map(({ functionName }: any) => ({
          auctionFor: auction, currentStage: 4, blocksSwaps: false, openTime: 1_000n, cycleDeadline: 1_900n, cycleId: 2n,
        } as any)[functionName]);
      },
      simulateContract: async (request: any) => ({ request, result: false }),
      waitForTransactionReceipt: async () => ({ status: 'success' }),
    };
    const result = await settleBellAuctions({
      BELL_AUCTION_REGISTRY: addr('9'),
      BELL_TRANSACTION_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      RH_MAINNET_RPC_PRIMARY: 'https://rpc.invalid',
      BELL_EXPECTED_CHAIN_ID: '4663',
    }, {
      nowSeconds: 1_500,
      publicClient: publicClient as any,
      walletClient: { writeContract: async () => '0xtx' } as any,
      fetchPools: async () => ({ pools }),
    });
    expect(batches.slice(0, 2)).toEqual([5, 25]); // one batch to find auctions, one to scan all of them
    expect(result.results.every((entry: any) => entry.status !== 'failed')).toBe(true);
    expect(batches.slice(2).every((size) => size === 5)).toBe(true); // re-reads are one batch per auction, not one call per field
  });

  it('reuses cached pool ids between refresh ticks instead of re-reading the whole directory', async () => {
    const cache = { static: { [addr('5')]: { poolId: `0x${'7'.repeat(64)}`, hook: addr('5') } } };
    const doStub = { fetch: async () => new Response(JSON.stringify(cache)) };
    const env = {
      BELL_AUCTION_REGISTRY: addr('9'),
      BELL_TRANSACTION_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      RH_MAINNET_RPC_PRIMARY: 'https://rpc.invalid',
      BELL_EXPECTED_CHAIN_ID: '4663',
      KEEPER_DO: { idFromName: () => 'id', get: () => doStub },
    };
    const publicClient = {
      getChainId: async () => 4663,
      multicall: async ({ contracts }: any) => contracts.map(() => '0x0000000000000000000000000000000000000000'),
    };
    let directoryReads = 0;
    const fetchPools = async () => { directoryReads += 1; return { pools: [] }; };
    // Minute 25 of the hour: not a refresh tick.
    await settleBellAuctions(env, { nowSeconds: 1_500, publicClient: publicClient as any, walletClient: {} as any, fetchPools });
    expect(directoryReads).toBe(0);
    // Minute 30: every tenth minute the directory is refreshed.
    await settleBellAuctions(env, { nowSeconds: 1_800, publicClient: publicClient as any, walletClient: {} as any, fetchPools });
    expect(directoryReads).toBe(1);
  });

  it('uses a separate log-capable client for pool discovery when provided', async () => {
    const primaryClient = { getChainId: async () => 4663 };
    const directoryClient = {};
    let clientUsed: unknown;
    const result = await settleBellAuctions({
      BELL_AUCTION_REGISTRY: addr('9'),
      BELL_TRANSACTION_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      BELL_RPC_URL: 'https://rpc-primary.invalid',
      RH_MAINNET_RPC_SECONDARY: 'https://rpc-logs.invalid',
      BELL_EXPECTED_CHAIN_ID: '4663',
    }, {
      nowSeconds: 1_500,
      publicClient: primaryClient as any,
      walletClient: {} as any,
      poolDirectoryClient: directoryClient as any,
      fetchPools: async (_env, options) => {
        clientUsed = options?.client;
        return { pools: [] };
      },
    });

    expect(clientUsed).toBe(directoryClient);
    expect(result).toMatchObject({ status: 'idle', eligibleCount: 0 });
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
