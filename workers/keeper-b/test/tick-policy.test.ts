import { describe, expect, it } from 'vitest';
import {
  evaluateQuote,
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
