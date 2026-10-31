import { describe, expect, it } from 'vitest';
import { buildCalendarActivation } from '../src/calendar-maintenance.mjs';

const AAPL = {
  assetId: '0x85cffee2c6ba44ec5e3e78ca6eba5bb87215a1bda3195519b39129adb58ec464',
  root: '0xcf44d11d124c9a4dcf7613c8d00040883931c4c8dde9c5560dacd60581fe086f',
  year: 2026, coverageStart: 1793370605, coverageEnd: 1798554605, capabilityMask: 30,
};

describe('permissionless calendar maintenance proofs', () => {
  it('rebuilds the committed 24/5 calendar root and returns a contiguous closed leaf', () => {
    const result = buildCalendarActivation({
      config: AAPL, chainId: 4663, calendarRegistry: '0xba9b5142f282dde204805d66fddb5d6256080926',
      assetId: AAPL.assetId, nowSeconds: 1793415679,
    });
    expect(result.phase).toBe(5);
    expect(result.current.start).toBeLessThanOrEqual(1793415679n);
    expect(result.current.end).toBeGreaterThan(1793415679n);
    expect(result.next.start).toBe(result.current.end);
    expect(result.proofs).toHaveLength(3);
  });

  it('fails closed if a locally rebuilt schedule does not match the published root', () => {
    expect(() => buildCalendarActivation({
      config: { ...AAPL, root: `0x${'11'.repeat(32)}` }, chainId: 4663,
      calendarRegistry: '0xba9b5142f282dde204805d66fddb5d6256080926',
      assetId: AAPL.assetId, nowSeconds: 1793415679,
    })).toThrow(/does not match the published root/);
  });
});
