import { describe, expect, it } from 'vitest';
import { runChainlinkStatus } from '../src/chainlink-status.mjs';

const ASSET_ID = `0x${'11'.repeat(32)}`;
const ADDRESS = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const env = {
  BELL_ORACLE_MODE: 'chainlink',
  BELL_EXPECTED_CHAIN_ID: '4663',
  BELL_ASSET_REGISTRY: ADDRESS(1),
  BELL_CALENDAR_REGISTRY: ADDRESS(2),
  BELL_SESSION_REGISTRY: ADDRESS(3),
  BELL_STOCK_ASSETS: JSON.stringify([{ symbol: 'AAPL', assetId: ASSET_ID }]),
};

function clientFor({ phase = 4, updatedAt = 950, anchorValid = false } = {}) {
  const calls: Array<{ address: string; functionName: string; blockNumber?: bigint }> = [];
  const adapter = phase === 2 ? ADDRESS(12) : phase === 4 ? ADDRESS(14) : ADDRESS(13);
  const feed = ADDRESS(20);
  const client = {
    getChainId: async () => 4663,
    getBlock: async () => ({ number: 500n, timestamp: 1_000n }),
    readContract: async ({ address, functionName, blockNumber }: { address: string; functionName: string; blockNumber?: bigint }) => {
      calls.push({ address, functionName, blockNumber });
      if (functionName === 'currentInterval') return {
        assetId: ASSET_ID, year: 2026, index: 7, start: 800n, end: 1_200n,
        phase, provenanceHash: `0x${'22'.repeat(32)}`,
      };
      if (functionName === 'descriptor') return {
        id: ASSET_ID, token: ADDRESS(30), isStock: true, decimals: 18, capabilityMask: 30,
        tokenPriceAdapter: ADDRESS(11), regularAdapter: ADDRESS(12), extendedAdapter: ADDRESS(13),
        overnightAdapter: ADDRESS(14), secondaryAdapter: ADDRESS(0),
        expectedCodeHash: `0x${'33'.repeat(32)}`, implementationFingerprint: `0x${'44'.repeat(32)}`,
        evidenceHash: `0x${'55'.repeat(32)}`,
      };
      if (functionName === 'feed') return feed;
      if (functionName === 'fingerprint') return `0x${'66'.repeat(32)}`;
      if (functionName === 'readCurrent') {
        if (1_000 - updatedAt >= 120) throw new Error('StalePrice');
        return { price18: 123n, observedAt: BigInt(updatedAt) };
      }
      if (functionName === 'latestRoundData') return [1n, 12_300_000_000n, BigInt(updatedAt), BigInt(updatedAt), 1n];
      if (functionName === 'anchorStatus') return [{}, anchorValid, 0n, 1_300n];
      throw new Error(`unexpected read ${functionName}`);
    },
  };
  return { client, calls };
}

describe('Chainlink Worker status', () => {
  it.each([
    [1, 'PRE', ADDRESS(13)],
    [2, 'REGULAR', ADDRESS(12)],
    [3, 'POST', ADDRESS(13)],
    [4, 'OVERNIGHT', ADDRESS(14)],
  ])('selects the %s %s adapter and reports its onchain freshness', async (phase, session, expectedAdapter) => {
    const { client, calls } = clientFor({ phase, updatedAt: 950 });
    const status = await runChainlinkStatus(env, { client: client as any });
    expect(status.mode).toBe('chainlink');
    expect(status.assets.AAPL).toMatchObject({ phase, session, feedAgeSeconds: 50, sessionFeedFresh: true });
    expect(calls).toContainEqual({ address: expectedAdapter, functionName: 'readCurrent', blockNumber: 500n });
  });

  it('reports an active-session feed at the strict 120 second boundary as stale', async () => {
    const { client } = clientFor({ phase: 2, updatedAt: 880 });
    const status = await runChainlinkStatus(env, { client: client as any });
    expect(status.assets.AAPL).toMatchObject({ phase: 2, session: 'REGULAR', feedAgeSeconds: 120, sessionFeedFresh: false });
  });

  it('checks the active calendar leaf anchor and reads feed age while the market is closed', async () => {
    const { client, calls } = clientFor({ phase: 5, anchorValid: false });
    const status = await runChainlinkStatus(env, { client: client as any });
    expect(status.assets.AAPL).toMatchObject({
      phase: 5, session: 'CLOSED', anchorValid: false, sessionFeedFresh: null,
      feedAgeSeconds: 50, freshnessLimitSeconds: 120, updatedAt: 950,
    });
    expect(calls.some((call) => call.functionName === 'anchorStatus')).toBe(true);
    expect(calls).toContainEqual({ address: ADDRESS(12), functionName: 'feed', blockNumber: 500n });
    expect(calls.some((call) => call.functionName === 'latestRoundData')).toBe(true);
    expect(calls.some((call) => call.functionName === 'readCurrent')).toBe(false);
  });
});
