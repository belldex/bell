import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ant-update.mjs', () => ({
  buildAntUpdate: async () => ({
    directSample: { descriptorId: `0x${'0'.repeat(64)}`, feedId: `0x${'0'.repeat(64)}`, phase: 0, price18: '1', observedAt: '1', inputAt: '1', validFrom: '1', expiresAt: '2', validUntil: '2', reportHash: `0x${'1'.repeat(64)}` },
    directSignature: '0x', reports: ['0x'],
  }),
}));
import { runAntKeeper } from '../src/ant-keeper.mjs';

const Z = `0x${'0'.repeat(64)}`;
const cfg = { assetId: `0x${'a'.repeat(64)}`, calendarRegistry: `0x${'c'.repeat(40)}`, haltRegistry: `0x${'d'.repeat(40)}`, auctionRegistry: `0x${'e'.repeat(40)}`, sessionRegistry: `0x${'f'.repeat(40)}`, pool: { hook: `0x${'b'.repeat(40)}`, poolId: `0x${'9'.repeat(64)}` } };
const NOW = 1_800_000_000;
const interval = (start: number, end: number, phase: number) => ({ assetId: cfg.assetId, year: 2026, index: 7, start: BigInt(start), end: BigInt(end), phase, provenanceHash: `0x${'5'.repeat(64)}` });

function harness(over: { cur?: unknown; nxt?: unknown; anchorValid?: boolean; reasonBits?: bigint; mode?: number; storedMode?: number; canSwap?: boolean; stage?: number; phase?: number }) {
  const writes: string[] = [];
  const policy = { canSwap: over.canSwap ?? true, mode: over.mode ?? 1, reasonBits: over.reasonBits ?? 0n };
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case 'phase': return over.phase ?? 0;
        case 'getPolicy': return policy;
        case 'state': return { mode: over.storedMode ?? policy.mode, closedLatched: false };
        case 'auctionFor': return `0x${'7'.repeat(40)}`;
        case 'currentStage': return over.stage ?? 0;
        case 'currentInterval': return over.cur ?? interval(NOW - 3000, NOW + 120, 3);
        case 'nextInterval': return over.nxt ?? interval(NOW + 120, NOW + 90_000, 5);
        case 'anchorStatus': return [true, over.anchorValid ?? false];
        default: throw new Error(`unexpected read ${functionName}`);
      }
    },
    simulateContract: async ({ functionName }: { functionName: string }) => ({ request: { functionName } }),
    estimateContractGas: async () => 100_000n,
    waitForTransactionReceipt: async () => ({ status: 'success' }),
  };
  const wallet = { writeContract: async (r: { functionName: string }) => { writes.push(r.functionName); return `0x${'1'.repeat(64)}`; } };
  return { client, wallet, writes };
}
const run = (h: ReturnType<typeof harness>) => runAntKeeper({ cfg, delegateKey: '0x01', client: h.client as never, wallet: h.wallet as never, account: { address: `0x${'2'.repeat(40)}` } as never, nowSeconds: NOW });

describe('ANT keeper', () => {
  it('does nothing while the pool is healthy and no closure is near', async () => {
    const h = harness({ nxt: interval(NOW + 120_000, NOW + 130_000, 4) });
    expect((await run(h)).status).toBe('idle');
    expect(h.writes).toEqual([]);
  });
  it('captures the closing anchor in the last five minutes before a planned closure: a report, then captureClose', async () => {
    const h = harness({});
    expect((await run(h)).status).toBe('acted');
    expect(h.writes).toEqual(['refreshStockWithReports', 'captureClose']);
  });
  it('does not capture twice when the anchor is already valid, or before the window', async () => {
    const valid = harness({ anchorValid: true });
    await run(valid); expect(valid.writes).toEqual([]);
    const early = harness({ cur: interval(NOW - 3000, NOW + 3000, 3), nxt: interval(NOW + 3000, NOW + 90_000, 5) });
    await run(early); expect(early.writes).toEqual([]);
  });
  it('publishes a report and checkpoints while the pool is recovering', async () => {
    const h = harness({ reasonBits: 1n << 12n, canSwap: false, mode: 3, nxt: interval(NOW + 120_000, NOW + 130_000, 4) });
    await run(h);
    expect(h.writes).toEqual(['refreshStockWithReports', 'refreshState']);
  });
  it('settles a locked auction only once the hook allows swaps, and arms the resume auction', async () => {
    const open = harness({ stage: 3, canSwap: true, nxt: interval(NOW + 120_000, NOW + 130_000, 4) });
    await run(open); expect(open.writes).toEqual(['settle']);
    const blocked = harness({ stage: 3, canSwap: false, nxt: interval(NOW + 120_000, NOW + 130_000, 4) });
    await run(blocked); expect(blocked.writes).toEqual([]);
    const resume = harness({ phase: 2, stage: 1, nxt: interval(NOW + 120_000, NOW + 130_000, 4) });
    await run(resume); expect(resume.writes).toContain('armResume');
  });
});

import { calendarRoots } from '../src/ant-calendar.mjs';
describe('ANT calendar roots list', () => {
  it('uses the list the renewal workflow publishes, and falls back to the compiled-in root when it cannot be read', async () => {
    const compiled = { root: '0xaa', coverageStart: 1, coverageEnd: 2 };
    const listed = [compiled, { root: '0xbb', coverageStart: 2, coverageEnd: 3 }];
    const ok = await calendarRoots({ calendar: compiled, calendarRootsUrl: 'https://x' }, (async () => ({ ok: true, json: async () => ({ roots: listed }) })) as never, 10 ** 12);
    expect(ok.length).toBe(2);
    const broken = await calendarRoots({ calendar: compiled, calendarRootsUrl: 'https://x' }, (async () => { throw new Error('offline'); }) as never, 2 * 10 ** 12);
    expect(broken).toEqual([compiled]);
  });
});
