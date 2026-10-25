import { describe, expect, it } from 'vitest';
import { nextAlarmTimestamp } from '../src/keeper-state.mjs';

describe('Keeper B alarm boundaries', () => {
  it('schedules the next 30-second boundary without replaying missed ticks', () => {
    expect(nextAlarmTimestamp(0)).toBe(30000);
    expect(nextAlarmTimestamp(29999)).toBe(30000);
    expect(nextAlarmTimestamp(30000)).toBe(60000);
  });

  it('rejects invalid alarm time values', () => {
    expect(() => nextAlarmTimestamp(-1)).toThrow(/alarm time/i);
    expect(() => nextAlarmTimestamp(Number.MAX_SAFE_INTEGER + 1)).toThrow(/alarm time/i);
  });
});
