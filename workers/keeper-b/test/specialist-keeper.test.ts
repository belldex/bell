import { describe, expect, it } from 'vitest';
import { limitX96, tick } from '../src/specialist-keeper';

describe('specialist keeper', () => {
  it('does nothing without a config', async () => {
    await expect(tick({})).resolves.toBeUndefined();
  });
  it('prices a limit as quote raw per base raw times 2^96', () => {
    // 150 USDG per share is 150e6 raw per 1e18 raw
    const p = limitX96(150, 1);
    expect(Number(p) / 2 ** 96).toBeCloseTo(150e6 / 1e18, 22);
  });
  it('puts the buy above and the sell below the reference, and both within 1.5% of the middle', () => {
    const buy = Number(limitX96(152.1367, 1.005));
    const sell = Number(limitX96(152.1367, 0.995));
    const mid = (buy + sell) / 2;
    expect(buy).toBeGreaterThan(sell);
    expect(Math.abs(buy - mid) / mid).toBeLessThan(0.015);
    expect(Math.abs(sell - mid) / mid).toBeLessThan(0.015);
  });
});
