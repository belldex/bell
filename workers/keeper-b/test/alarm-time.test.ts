import { describe, expect, it } from 'vitest';
import { nextAlarmTimestamp } from '../src/keeper-state.mjs';

describe('Keeper B alarm boundaries', () => {
  it('schedules the next 90-second boundary without replaying missed ticks', () => {
    expect(nextAlarmTimestamp(0)).toBe(90000);
    expect(nextAlarmTimestamp(89999)).toBe(90000);
    expect(nextAlarmTimestamp(90000)).toBe(180000);
  });

  it('rejects invalid alarm time values', () => {
    expect(() => nextAlarmTimestamp(-1)).toThrow(/alarm time/i);
    expect(() => nextAlarmTimestamp(Number.MAX_SAFE_INTEGER + 1)).toThrow(/alarm time/i);
  });
});
