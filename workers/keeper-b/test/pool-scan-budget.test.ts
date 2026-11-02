import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cloudflare Workers cap a single invocation at 50 subrequests. The pool directory scans a block
// range by paging eth_getLogs, so the number of pages it issues must stay under that ceiling.
const CLOUDFLARE_SUBREQUEST_LIMIT = 50;

const chain = {
  chainId: 4663,
  blockNumber: 0n,
  getChainId: vi.fn(async () => chain.chainId),
  getBlockNumber: vi.fn(async () => chain.blockNumber),
  request: vi.fn(async () => []),
  readContract: vi.fn(async () => {
    throw new Error('no pool is discovered in this test');
  }),
};

const { runPools, runPositionCandidates } = await import('../src/index');

const env = {
  BELL_POOL_FACTORY: `0x${'ab'.repeat(20)}`,
  BELL_EXPECTED_CHAIN_ID: '4663',
  BELL_POOL_SCAN_FROM_BLOCK: '102445470',
  RH_MAINNET_RPC_SECONDARY: 'https://rpc.test',
};

describe('pool directory subrequest budget', () => {
  beforeEach(() => {
    chain.request.mockClear();
    chain.readContract.mockClear();
  });

  it('never exceeds the Cloudflare subrequest ceiling for a long block range', async () => {
    // ~1.02M blocks is the live Mainnet range that broke production with 52 parallel pages.
    chain.blockNumber = 102445470n + 1_021_000n;
    await runPools(env, { client: chain }).catch(() => {});
    expect(chain.request.mock.calls.length).toBeGreaterThan(0);
    expect(chain.request.mock.calls.length).toBeLessThan(CLOUDFLARE_SUBREQUEST_LIMIT);
  });

  it('covers the whole range it claims to scan', async () => {
    chain.blockNumber = 102445470n + 1_021_000n;
    await runPools(env, { client: chain }).catch(() => {});
    const ranges = chain.request.mock.calls.map(([request]) => {
      const [filter] = request.params;
      return [BigInt(filter.fromBlock), BigInt(filter.toBlock)];
    });
    ranges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    expect(ranges[0][0]).toBe(102445470n);
    expect(ranges[ranges.length - 1][1]).toBe(chain.blockNumber);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i][0]).toBe(ranges[i - 1][1] + 1n);
    }
  });

  it('still returns an empty directory for a range that fits in one page', async () => {
    chain.blockNumber = 102445470n + 500n;
    const result = await runPools(env, { client: chain });
    expect(result).toMatchObject({ chainId: 4663, pools: [] });
  });

  it('keeps the position scan inside the same subrequest ceiling', async () => {
    chain.blockNumber = 102445470n + 1_021_000n;
    chain.request.mockClear();
    await runPositionCandidates(
      { ...env, BELL_POSITION_MANAGER: `0x${'cd'.repeat(20)}` },
      `0x${'11'.repeat(20)}`,
      { client: chain },
    ).catch(() => {});
    expect(chain.request.mock.calls.length).toBeGreaterThan(0);
    expect(chain.request.mock.calls.length).toBeLessThan(CLOUDFLARE_SUBREQUEST_LIMIT);
  });
});
