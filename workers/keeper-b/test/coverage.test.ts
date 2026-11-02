import { describe, expect, it } from 'vitest';
import { isScheduledMaintenanceWindow } from '../src/tick-policy.mjs';

// The calendar died twice because the cron schedule left session boundaries uncovered.
// Contract being pinned here: the crons fire every hour at :55-:59 and :00-:09, so the
// maintenance window must be exactly [boundary-5 .. boundary+9] minutes for EVERY DST
// offset — otherwise a boundary can pass with the Worker asleep.
const BOUNDARIES = [0, 240, 570, 780, 960, 1020, 1200];

function inList(v: number, list: string) {
  return list.split(',').some((p) => {
    if (p.includes('-')) { const [a, b] = p.split('-').map(Number); return v >= a && v <= b; }
    return v === Number(p);
  });
}
function cronMinuteOk(m: number, h?: number) {
  // Mirrors wrangler.jsonc: two cron entries on the Workers Free plan.
  if (inList(m, '55-59,0-9')) return true;
  // The 09:30 ET open lands at 14:20-14:39 UTC (EST) or 13:20-13:39 UTC (EDT).
  if (h !== undefined && inList(h, '13-14') && inList(m, '20-39')) return true;
  return false;
}
function windowOpenEt(minOfDay: number) {
  return BOUNDARIES.some((b) => {
    const before = (b - minOfDay + 1440) % 1440;
    const after = (minOfDay - b + 1440) % 1440;
    return (before > 0 && before <= 5) || after <= 9;
  });
}

describe('calendar maintenance coverage', () => {
  it('the crons cover :55-:59 and :00-:09 of every hour and nothing else', () => {
    for (let m = 0; m < 60; m += 1) {
      const covered = cronMinuteOk(m);
      if (m <= 9 || m >= 55) expect(covered, `minute ${m} must be covered`).toBe(true);
      else expect(covered, `minute ${m} must not fire`).toBe(false);
    }
  });

  it('every minute inside the maintenance window has cron coverage, at any DST offset', () => {
    const gaps: string[] = [];
    for (const dst of [300, 240]) { // EST +5h, EDT +4h
      for (const boundary of BOUNDARIES) {
        const utcBoundary = (boundary + dst) % 1440;
        for (let offset = -5; offset <= 9; offset += 1) {
          const t = (utcBoundary + offset + 1440) % 1440;
          if (!cronMinuteOk(t % 60, Math.floor(t / 60))) gaps.push(`ET boundary ${boundary}, DST ${dst / 60}h, offset ${offset} -> ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('the window guard covers exactly [boundary-5 .. boundary+9]', () => {
    for (const boundary of BOUNDARIES) {
      expect(windowOpenEt(boundary - 5)).toBe(true);
      expect(windowOpenEt(boundary - 6)).toBe(false);
      expect(windowOpenEt(boundary)).toBe(true);
      expect(windowOpenEt(boundary + 9)).toBe(true);
      expect(windowOpenEt(boundary + 10)).toBe(false);
    }
  });

  it('the guard still refuses clearly non-boundary times', () => {
    for (const min of [15, 30, 45]) {
      expect(windowOpenEt(min)).toBe(false);
    }
  });

  it('the live window helper agrees with the pinned minute-of-day model (EST sample)', () => {
    // ET boundary 240 (04:00) with EST +5h = 09:00 UTC. Offsets -5..+9 must all open.
    const base = Date.UTC(2026, 10, 2, 9, 0, 0); // Nov 2 is EST
    for (let offset = -5; offset <= 9; offset += 1) {
      const at = new Date(base + offset * 60_000);
      expect(isScheduledMaintenanceWindow(Math.floor(at.getTime() / 1000)), `offset ${offset}`).toBe(true);
    }
  });
});
