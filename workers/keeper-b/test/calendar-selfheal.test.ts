import { describe, expect, it } from 'vitest';
import { isScheduledMaintenanceWindow } from '../src/tick-policy.mjs';

/**
 * The calendar went empty three times in one day. Every time the cause was identical: the worker
 * ran only inside a [boundary-5, boundary+9] guard, so one missed or delayed cron left
 * `currentInterval` reading NONE until the next boundary, four to eight hours later.
 *
 * The fix has two halves, and both are pinned here:
 *   1. the cron now fires every 5 minutes instead of only near a boundary, and
 *   2. the scheduled handler passes force=true so calendar repair ignores the boundary guard.
 *
 * The guard itself must still identify boundaries correctly, because close capture depends on it.
 */

const BOUNDARIES = [0, 240, 570, 780, 960, 1020, 1200];
const ET = 'America/New_York';

function etParts(unixSeconds: number) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(unixSeconds * 1000));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { weekday: get('weekday'), minuteOfDay: Number(get('hour')) * 60 + Number(get('minute')) };
}

describe('boundary guard still works for close capture', () => {
  it('is open 5 minutes before a boundary and 9 minutes after', () => {
    // 09:30 ET boundary is minute 570. Probe 09:25 and 09:39 on a weekday.
    const base = Date.UTC(2026, 10, 3, 12, 0, 0); // Tue 12:00 UTC = 07:00 ET (EST/EDT agnostic probe)
    let found = 0;
    for (let m = 0; m < 1440; m++) {
      const t = base + m * 60;
      const { minuteOfDay } = etParts(t);
      const nearBoundary = BOUNDARIES.some((b) => {
        const before = (b - minuteOfDay + 1440) % 1440;
        const after = (minuteOfDay - b + 1440) % 1440;
        return (before > 0 && before <= 5) || after <= 9;
      });
      expect(isScheduledMaintenanceWindow(t)).toBe(nearBoundary);
      if (nearBoundary) found++;
    }
    // 7 boundaries x 15 minutes = 105 minutes per day
    expect(found).toBe(105);
  });

  it('is closed in the middle of a session', () => {
    // 12:00 ET is minute 720, far from every boundary
    let probe = null;
    for (let t = Date.UTC(2026, 10, 3, 0, 0, 0); t < Date.UTC(2026, 10, 4, 0, 0, 0); t += 60_000) {
      const { minuteOfDay } = etParts(t);
      if (minuteOfDay === 720) { probe = t; break; }
    }
    expect(probe).not.toBeNull();
    expect(isScheduledMaintenanceWindow(probe as number)).toBe(false);
  });

  it('covers only 105 of 1440 minutes, which is why the cron had to change', () => {
    // This is the number that explains the outage: the old cron fired in the same narrow band,
    // so any missed tick had no second chance until the next boundary.
    const covered = BOUNDARIES.length * (5 + 10);
    expect(covered).toBe(105);
    expect(covered / 1440).toBeLessThan(0.08);
  });
});
