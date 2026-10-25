import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionReportLedger } from '../src/report-ledger.mjs';

const report = (n, observedAt, encodedBytes = 100) => ({
  feedId: `0x${n.toString(16).padStart(64, '0')}`,
  reportHash: `0x${(n + 100).toString(16).padStart(64, '0')}`,
  observedAt,
  phase: 2,
  encodedBytes,
});

test('accepts a bounded batch and advances observation high-water per feed', () => {
  const ledger = new SessionReportLedger();
  const result = ledger.submitBatch([report(1, 100), report(2, 100)], 101);
  assert.equal(result.accepted, true);
  assert.equal(ledger.highWater('0x' + '0'.repeat(63) + '1'), 100);
});

test('rejects replay and duplicate feed without changing any batch high-water', () => {
  const ledger = new SessionReportLedger();
  ledger.submitBatch([report(1, 100)], 101);
  const staleAndNew = ledger.submitBatch([report(1, 100), report(2, 102)], 103);
  assert.equal(staleAndNew.accepted, false);
  assert.equal(ledger.highWater(report(2, 102).feedId), null);
  assert.equal(ledger.submitBatch([report(3, 103), report(3, 104)], 105).accepted, false);
  assert.equal(ledger.highWater(report(3, 103).feedId), null);
});

test('enforces per-report and six-report bounds while allowing the exact aggregate-byte ceiling', () => {
  const ledger = new SessionReportLedger();
  assert.equal(ledger.submitBatch([report(1, 100, 16385)], 101).accepted, false);
  assert.equal(ledger.submitBatch(Array.from({ length: 7 }, (_, index) => report(index + 1, 100)), 101).accepted, false);
  assert.equal(ledger.submitBatch(Array.from({ length: 6 }, (_, index) => report(index + 1, 100, 16384)), 101).accepted, true);
  assert.equal(ledger.highWater(report(1, 100).feedId), 100);
});

test('rejects invalid and future report metadata without partial updates', () => {
  const ledger = new SessionReportLedger();
  assert.equal(ledger.submitBatch([report(1, 100), { ...report(2, 200), phase: 0 }], 150).accepted, false);
  assert.equal(ledger.highWater(report(1, 100).feedId), null);
});
