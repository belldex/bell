import { describe, expect, it } from 'vitest';
import { runPositionCandidates } from '../src/index.ts';

const owner = '0xf3784048450e72596cd18bf079aed441894176e4';

function fakeChain(latest: bigint) {
  const ranges: Array<[bigint, bigint]> = [];
  return {
    ranges,
    getChainId: async () => 4663,
    getBlockNumber: async () => latest,
    request: async ({ params }: any) => {
      ranges.push([BigInt(params[0].fromBlock), BigInt(params[0].toBlock)]);
      return [];
    },
  };
}

describe('position discovery scan range', () => {
  const base = { RH_MAINNET_RPC_SECONDARY: 'https://rpc.invalid', BELL_POSITION_MANAGER: '0x84da249aafa359886c6a2ae1ebdc78a6059b662d', BELL_EXPECTED_CHAIN_ID: '4663' };

  it('starts at the position scan block, not at the newest factory block', async () => {
    // A factory upgrade moves the pool scan forward; NFTs minted before it must still be found.
    const chain = fakeChain(107_500_000n);
    await runPositionCandidates({ ...base, BELL_POOL_SCAN_FROM_BLOCK: '107254141', BELL_POSITION_SCAN_FROM_BLOCK: '102445453' }, owner, { client: chain as any });
    expect(chain.ranges[0][0]).toBe(102_445_453n);
    expect(chain.ranges.at(-1)![1]).toBe(107_500_000n);
  });

  it('falls back to the pool scan block when no position scan block is configured', async () => {
    const chain = fakeChain(107_500_000n);
    await runPositionCandidates({ ...base, BELL_POOL_SCAN_FROM_BLOCK: '107254141' }, owner, { client: chain as any });
    expect(chain.ranges[0][0]).toBe(107_254_141n);
  });
});
