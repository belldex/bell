import { describe, expect, it } from 'vitest';
import { KeeperState } from '../src/keeper-state.mjs';

function stateFixture() {
  const values = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => { values.set(key, value); },
  };
  const state = new KeeperState({ storage }, {} as any);
  return { state, values };
}

describe('auction settlement status recording', () => {
  it('persists latest result and bounded history for /status', async () => {
    const { state, values } = stateFixture();
    const response = await state.fetch(new Request('https://do/auction-settlement', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'settled', eligibleCount: 1, results: [{ status: 'settled', txHash: '0xabc' }] }),
    }));

    expect(response.status).toBe(200);
    expect(values.get('lastAuctionSettlement')).toMatchObject({ status: 'settled', eligibleCount: 1 });
    expect(values.get('auctionSettlementLog')).toEqual([
      expect.objectContaining({ status: 'settled', eligibleCount: 1 }),
    ]);
  });

  it('rejects GET writes and keeps method semantics explicit', async () => {
    const { state } = stateFixture();
    const response = await state.fetch(new Request('https://do/auction-settlement'));
    expect(response.status).toBe(405);
  });
});
