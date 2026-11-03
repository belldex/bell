import { describe, expect, it } from 'vitest';
import { toFunctionSelector } from 'viem';
import { CALENDAR_ABI } from '../src/index.ts';

/**
 * The calendar went empty three times in one day.
 *
 * Root cause: the worker declared CalendarLeaf.year as uint16. Onchain it is uint32
 * (ProtocolTypes.sol:92). A uint16 year changes the function selector, so `activateInterval`
 * reverted as an unknown function and `currentInterval` failed to decode — which surfaced as
 * "Cannot read properties of undefined (reading 'length')", looking like a script bug rather than
 * an ABI mismatch. Two days of outages traced back to this one type.
 *
 * CalendarLeaf fields in order: assetId(bytes32), year, index, start, end, phase, provenanceHash.
 * viem parses these tuples with unnamed components, so the year is components[1].
 */

const YEAR_INDEX = 1;
const LEAF_UINT32 = '(bytes32,uint32,uint32,uint64,uint64,uint8,bytes32)';
const LEAF_UINT16 = '(bytes32,uint16,uint32,uint64,uint64,uint8,bytes32)';

describe('calendar ABI', () => {
  it('activateInterval resolves to the canonical uint32 selector', () => {
    const canonical = toFunctionSelector(
      `function activateInterval(bytes32,${LEAF_UINT32},${LEAF_UINT32},${LEAF_UINT32},bytes32[][])`,
    );
    const wrong = toFunctionSelector(
      `function activateInterval(bytes32,${LEAF_UINT16},${LEAF_UINT16},${LEAF_UINT16},bytes32[][])`,
    );
    expect(canonical).toBe('0x13ac8a5f');
    expect(wrong).not.toBe(canonical);

    const found = CALENDAR_ABI.filter((e) => e.type === 'function' && e.name === 'activateInterval');
    expect(found).toHaveLength(1);

    const tuples = ((found[0] as any).inputs as any[]).filter((i) => i.type === 'tuple');
    expect(tuples).toHaveLength(3);
    for (const t of tuples) {
      expect(t.components[YEAR_INDEX].type, 'CalendarLeaf.year must be uint32').toBe('uint32');
    }
  });

  it('currentInterval returns a uint32 year', () => {
    const fn: any = CALENDAR_ABI.find((e) => e.type === 'function' && e.name === 'currentInterval');
    expect(fn).toBeDefined();
    expect(fn.outputs[0].components[YEAR_INDEX].type).toBe('uint32');
  });

  it('nextInterval returns a uint32 year', () => {
    const fn: any = CALENDAR_ABI.find((e) => e.type === 'function' && e.name === 'nextInterval');
    expect(fn).toBeDefined();
    expect(fn.outputs[0].components[YEAR_INDEX].type).toBe('uint32');
  });

  it('no calendar entry declares a uint16 year anywhere', () => {
    const flat = JSON.stringify(CALENDAR_ABI);
    expect(flat).not.toContain('"uint16"');
  });
});

describe('boundary guard', () => {
  it('covers under 8 percent of the day, which is why repair cannot depend on it', async () => {
    const { isScheduledMaintenanceWindow } = await import('../src/tick-policy.mjs');
    let open = 0;
    const start = Date.UTC(2026, 10, 3, 0, 0, 0) / 1000;
    for (let m = 0; m < 1440; m++) {
      if (isScheduledMaintenanceWindow(start + m * 60)) open++;
    }
    expect(open).toBeGreaterThanOrEqual(100);
    expect(open).toBeLessThanOrEqual(110);
    expect(open / 1440).toBeLessThan(0.08);
  });
});
