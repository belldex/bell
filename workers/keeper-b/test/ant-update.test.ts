import { describe, expect, it } from 'vitest';
import { readAntPrice, AntUpdateError } from '../src/ant-update.mjs';

const quote = (over: Record<string, unknown>, now = Date.parse('2026-11-24T03:00:00Z')) => ({
  fetchImpl: async () => ({ ok: true, json: async () => ({ quotes: [{ isTradingHalt: false, tokenBid: '86.00', tokenAsk: '86.10', generatedAt: new Date(now - 5_000).toISOString(), ...over }] }) }),
  now,
});

describe('ANT price for the swap-carried update', () => {
  it('returns the bid/ask midpoint', async () => {
    const { fetchImpl, now } = quote({});
    expect(await readAntPrice('ANT', fetchImpl as any, now)).toBeCloseTo(86.05, 6);
  });
  it('refuses a halt, a wide spread and an old quote', async () => {
    for (const over of [{ isTradingHalt: true }, { tokenBid: '80', tokenAsk: '90' }, { generatedAt: '2026-11-24T02:00:00Z' }]) {
      const { fetchImpl, now } = quote(over);
      await expect(readAntPrice('ANT', fetchImpl as any, now)).rejects.toBeInstanceOf(AntUpdateError);
    }
  });
  it('treats a failed source as unavailable', async () => {
    await expect(readAntPrice('ANT', (async () => { throw new Error('dns'); }) as any)).rejects.toMatchObject({ status: 503 });
  });
});
