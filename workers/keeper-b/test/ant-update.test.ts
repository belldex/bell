import { describe, expect, it } from 'vitest';
import { readAntPrice, buildAntUpdate, AntUpdateError } from '../src/ant-update.mjs';

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

describe('a report carried through a CLOSED interval', () => {
  const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
  const b32 = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
  const cfg = { assetId: b32(1), calendarRegistry: addr(2), adapters: { tokenPriceAdapter: addr(10), regularAdapter: addr(11), extendedAdapter: addr(12), overnightAdapter: addr(13) }, feedIds: [b32(20), b32(21), b32(22), b32(23)] };
  const now = Math.floor(Date.now() / 1000);
  const client = (phase: number) => ({
    getBlock: async () => ({ timestamp: BigInt(now) }),
    readContract: async ({ functionName }: { functionName: string }) => (functionName === 'currentInterval' ? { start: BigInt(now - 100), end: BigInt(now + 100), phase } : b32(99)),
  });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ quotes: [{ isTradingHalt: false, tokenBid: '77.70', tokenAsk: '77.75', generatedAt: new Date().toISOString() }] }) });
  const key = `0x${'1'.padStart(64, '0')}`;
  it('refuses CLOSED unless the caller asks for the carrier', async () => {
    await expect(buildAntUpdate({ cfg, delegateKey: key, client: client(5) as any, fetchImpl: fetchImpl as any })).rejects.toBeInstanceOf(AntUpdateError);
  });
  it('signs a report for CLOSED when the carrier is requested, and still reports session 5', async () => {
    const bundle = await buildAntUpdate({ cfg, delegateKey: key, client: client(5) as any, fetchImpl: fetchImpl as any, closedCarrier: true });
    expect(bundle.session).toBe(5);
    expect(bundle.reports).toHaveLength(1);
  });
  it('leaves the normal sessions unchanged', async () => {
    const bundle = await buildAntUpdate({ cfg, delegateKey: key, client: client(2) as any, fetchImpl: fetchImpl as any });
    expect(bundle.session).toBe(2);
  });
});
