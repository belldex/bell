import { describe, expect, it } from 'vitest';
import { evaluateQuote, reportValidUntil, wireForCalendarPhase } from '../src/tick-policy.mjs';

/**
 * The Worker's publish path must build a report that the onchain adapter will accept:
 * phase matches the calendar, validity never outlives the observation, and the feed comes
 * from the admitted wire for that phase.
 */
describe('publish path invariants', () => {
  const adapters = {
    regularWire: { feedId: '0xregular' },
    regularWireHash: '0xrh',
    extendedWire: { feedId: '0xextended' },
    extendedWireHash: '0xeh',
  };

  it('builds a PRE report against the extended feed, never the regular one', () => {
    const quote = { phase: 'PRE', observedAt: 1_000 };
    expect(evaluateQuote({ calendarPhase: 1, quote, nowSeconds: 1_010 }).ok).toBe(true);
    expect(wireForCalendarPhase(adapters, 1)).toEqual({ wire: adapters.extendedWire, wireHash: '0xeh' });
  });

  it('builds a REGULAR report against the regular feed', () => {
    const quote = { phase: 'REGULAR', observedAt: 1_000 };
    expect(evaluateQuote({ calendarPhase: 2, quote, nowSeconds: 1_010 }).ok).toBe(true);
    expect(wireForCalendarPhase(adapters, 2)).toEqual({ wire: adapters.regularWire, wireHash: '0xrh' });
  });

  it('refuses to publish a PRE quote while the calendar says REGULAR', () => {
    const result = evaluateQuote({ calendarPhase: 2, quote: { phase: 'PRE', observedAt: 1_000 }, nowSeconds: 1_010 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match/);
  });

  it('never lets validity outlive the observation freshness window', () => {
    // Observation is already 100s old; receipt is now, but validity must still cap at obs+119.
    expect(reportValidUntil(1_100, 1_000)).toBe(1_119);
    // A quote observed exactly at the freshness edge has no usable validity left.
    expect(() => reportValidUntil(1_120, 1_000)).toThrow();
  });
});
