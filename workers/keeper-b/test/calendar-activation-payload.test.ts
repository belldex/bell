import { describe, expect, it } from 'vitest';
import { encodeFunctionData, decodeFunctionData, toFunctionSelector } from 'viem';
import { CALENDAR_ABI } from '../src/index.ts';
import { buildCalendarActivation } from '../src/calendar-maintenance.mjs';

/**
 * End-to-end proof that the worker can build and encode a calendar activation, without waiting for
 * a real boundary.
 *
 * The 09:00 UTC outage happened because ABI encoding threw before any RPC call: the CalendarLeaf
 * tuples were anonymous, so viem expected positional arrays while the builder returns objects, and
 * `year` was uint16 where the contract uses uint32. Neither defect needed a network to detect — a
 * round trip on the exact payload does.
 *
 * The commitment below is the live AAPL root from evidence/deploy/mainnet-4663-calendar-state-AAPL.json,
 * inlined so this test is hermetic and runs anywhere. `buildCalendarActivation` re-derives the root
 * from the session table and throws if it does not match, so the constant also verifies the builder.
 */

const COMMITMENT = {
  root: '0x6c4ebe1609026e3960c84713e403cc0c310ec737bc7f5ed3eb96d4c170f74b32',
  year: 2026,
  coverageStart: 1793419842,
  coverageEnd: 1798603842,
  capabilityMask: 30,
};
const ASSET_ID = '0x846db71c8d321ca12d7708c8158112a62f5c770799bbb1e9786beb977c0e6746';
const CALENDAR_REGISTRY = '0x394983BfF2715d57197389F323d807b0D61c05a3';
const CHAIN_ID = 4663;

function activationAt(nowSeconds: number) {
  return buildCalendarActivation({
    config: COMMITMENT,
    chainId: CHAIN_ID,
    calendarRegistry: CALENDAR_REGISTRY,
    assetId: ASSET_ID,
    nowSeconds,
  });
}

describe('calendar activation payload', () => {
  it('rebuilds the live root, proving the builder matches the published commitment', () => {
    // buildCalendarActivation throws when the rebuilt root differs from config.root.
    expect(() => activationAt(Date.UTC(2026, 10, 3, 15, 0, 0) / 1000)).not.toThrow();
  });

  it('round-trips a real boundary activation through the worker ABI', () => {
    // Just after the Regular session ends and Post begins: the moment currentInterval reads empty.
    const boundarySeconds = Date.UTC(2026, 10, 3, 21, 0, 0) / 1000;
    const justAfter = boundarySeconds + 30;

    const activation = activationAt(justAfter);

    // The leaf being activated must actually cover the moment of activation. The registry enforces
    // this itself via validateNeighbors.
    expect(Number(activation.current.start)).toBeLessThanOrEqual(justAfter);
    expect(Number(activation.current.end)).toBeGreaterThan(justAfter);

    const args = [ASSET_ID, activation.current, activation.previous, activation.next, activation.proofs];
    const data = encodeFunctionData({ abi: CALENDAR_ABI, functionName: 'activateInterval', args });

    // The deployed selector, not the uint16 variant.
    expect(data.slice(0, 10)).toBe('0x13ac8a5f');

    // And it decodes back to the same leaf, so every field survived the object-shaped encode.
    const decoded = decodeFunctionData({ abi: CALENDAR_ABI, functionName: 'activateInterval', data });
    const [decodedAsset, decodedCurrent] = decoded.args as any[];
    expect(decodedAsset).toBe(ASSET_ID);
    expect(decodedCurrent.year).toBe(activation.current.year);
    expect(decodedCurrent.index).toBe(activation.current.index);
    expect(decodedCurrent.phase).toBe(activation.current.phase);
    expect(decodedCurrent.start).toBe(activation.current.start);
    expect(decodedCurrent.end).toBe(activation.current.end);
    expect(decodedCurrent.provenanceHash).toBe(activation.current.provenanceHash);
  });

  it('encodes a valid payload at every daily boundary', () => {
    const boundaries = [
      Date.UTC(2026, 10, 3, 9, 0, 30) / 1000,
      Date.UTC(2026, 10, 3, 14, 30, 30) / 1000,
      Date.UTC(2026, 10, 3, 21, 0, 30) / 1000,
      Date.UTC(2026, 10, 4, 1, 0, 30) / 1000,
      Date.UTC(2026, 10, 4, 9, 0, 30) / 1000,
    ];
    for (const t of boundaries) {
      const activation = activationAt(t);
      expect(Number(activation.current.start)).toBeLessThanOrEqual(t);
      expect(Number(activation.current.end)).toBeGreaterThan(t);
      expect(activation.proofs).toHaveLength(3);
      for (const proof of activation.proofs) expect(Array.isArray(proof)).toBe(true);
      const data = encodeFunctionData({
        abi: CALENDAR_ABI, functionName: 'activateInterval',
        args: [ASSET_ID, activation.current, activation.previous, activation.next, activation.proofs],
      });
      expect(data.slice(0, 10)).toBe('0x13ac8a5f');
    }
  });

  it('the worker ABI selector matches the deployed registry signature', () => {
    const fn: any = CALENDAR_ABI.find((e) => e.type === 'function' && e.name === 'activateInterval');
    const types = (fn.inputs as any[]).map((i) =>
      i.type === 'tuple' ? `(${i.components.map((c: any) => c.type).join(',')})` : i.type);
    expect(toFunctionSelector(`function activateInterval(${types.join(',')})`)).toBe('0x13ac8a5f');
  });
});
