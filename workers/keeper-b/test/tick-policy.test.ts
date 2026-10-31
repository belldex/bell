import { describe, expect, it } from 'vitest';
import {
  evaluateQuote,
  isCloseCaptureWindow,
  isScheduledMaintenanceWindow,
  phaseNameForCalendarPhase,
  reportValidUntil,
  sessionPhaseCode,
  wireForCalendarPhase,
} from '../src/tick-policy.mjs';

const adapters = {
  regularWire: { feedId: '0xregular' },
  regularWireHash: '0xrh',
  extendedWire: { feedId: '0xextended' },
  extendedWireHash: '0xeh',
  overnightWire: { feedId: '0xovernight' },
  overnightWireHash: '0xoh',
};

describe('calendar phase mapping', () => {
  it('maps only the phases Yahoo can actually source', () => {
    expect(phaseNameForCalendarPhase(1)).toBe('PRE');
    expect(phaseNameForCalendarPhase(2)).toBe('REGULAR');
    expect(phaseNameForCalendarPhase(3)).toBe('POST');
    expect(phaseNameForCalendarPhase(4)).toBeNull();
    expect(phaseNameForCalendarPhase(5)).toBeNull();
  });

  it('maps a Yahoo phase to the onchain session phase code', () => {
    expect(sessionPhaseCode('PRE')).toBe(1);
    expect(sessionPhaseCode('REGULAR')).toBe(2);
    expect(sessionPhaseCode('POST')).toBe(3);
    expect(sessionPhaseCode('CLOSED')).toBeNull();
  });

  it('selects the admitted wire per phase and refuses closed phases', () => {
    expect(wireForCalendarPhase(adapters, 2)).toEqual({ wire: adapters.regularWire, wireHash: '0xrh' });
    expect(wireForCalendarPhase(adapters, 1)).toEqual({ wire: adapters.extendedWire, wireHash: '0xeh' });
    expect(wireForCalendarPhase(adapters, 3)).toEqual({ wire: adapters.extendedWire, wireHash: '0xeh' });
    expect(wireForCalendarPhase(adapters, 5)).toBeNull();
  });
});

describe('planned close anchor window', () => {
  const current = { start: 100n, end: 1_000n, phase: 2 };
  const upcoming = { start: 1_000n, end: 2_000n, phase: 5 };

  it('only attaches a close boundary during the final five minutes of a supported session', () => {
    expect(isCloseCaptureWindow(current, upcoming, 701)).toBe(true);
    expect(isCloseCaptureWindow(current, upcoming, 700)).toBe(true);
    expect(isCloseCaptureWindow(current, upcoming, 699)).toBe(false);
    expect(isCloseCaptureWindow(current, upcoming, 1_000)).toBe(false);
  });

  it('rejects gaps, non-closure phases, and unsupported calendar phases', () => {
    expect(isCloseCaptureWindow(current, { ...upcoming, start: 1_001n }, 900)).toBe(false);
    expect(isCloseCaptureWindow(current, { ...upcoming, phase: 2 }, 900)).toBe(false);
    expect(isCloseCaptureWindow({ ...current, phase: 5 }, upcoming, 900)).toBe(false);
  });
});

describe('UTC market maintenance schedule', () => {
  const stamp = (day: string, hour: number, minute: number) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`) / 1000;

  it('covers both US daylight offsets and weekdays while ignoring cross-product cron minutes', () => {
    expect(isScheduledMaintenanceWindow(stamp('2026-10-30', 19, 55))).toBe(true); // 15:55 EDT
    expect(isScheduledMaintenanceWindow(stamp('2026-11-02', 20, 55))).toBe(true); // 15:55 EST
    expect(isScheduledMaintenanceWindow(stamp('2026-11-02', 14, 30))).toBe(true); // 09:30 EST
    expect(isScheduledMaintenanceWindow(stamp('2026-11-02', 14, 35))).toBe(false);
    expect(isScheduledMaintenanceWindow(stamp('2026-11-01', 20, 55))).toBe(false);
  });
});

describe('quote admission', () => {
  it('accepts a fresh quote whose phase matches the calendar', () => {
    const result = evaluateQuote({ calendarPhase: 2, quote: { phase: 'REGULAR', observedAt: 1_000 }, nowSeconds: 1_030 });
    expect(result).toEqual({ ok: true, phase: 2 });
  });

  it('rejects a phase mismatch instead of relabelling the quote', () => {
    const result = evaluateQuote({ calendarPhase: 2, quote: { phase: 'PRE', observedAt: 1_000 }, nowSeconds: 1_030 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match/);
  });

  it('rejects stale quotes and closed calendar phases', () => {
    expect(evaluateQuote({ calendarPhase: 2, quote: { phase: 'REGULAR', observedAt: 1_000 }, nowSeconds: 1_200 }).ok).toBe(false);
    expect(evaluateQuote({ calendarPhase: 5, quote: { phase: 'CLOSED', observedAt: 1_000 }, nowSeconds: 1_030 }).ok).toBe(false);
    expect(evaluateQuote({ calendarPhase: 2, quote: null, nowSeconds: 1_030 }).ok).toBe(false);
  });
});

describe('report validity', () => {
  it('caps validity at the stricter of receipt and observation freshness', () => {
    expect(reportValidUntil(1_000, 950)).toBe(1_069);
    expect(reportValidUntil(1_000, 980)).toBe(1_099);
    expect(() => reportValidUntil(1_000, 880)).toThrow(/no remaining report validity/);
  });
});
