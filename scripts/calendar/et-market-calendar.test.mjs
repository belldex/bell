import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEtMarketIntervals, etWallTimeToUnix, etOffsetSeconds } from './et-market-calendar.mjs';

test('resolves the US Eastern offset across the 2026 DST boundaries', () => {
  // DST ends 2026-11-01 02:00 ET, starts 2026-03-08 02:00 ET.
  assert.equal(etOffsetSeconds(Date.UTC(2026, 9, 30, 13, 30) / 1000), -4 * 3600);
  assert.equal(etOffsetSeconds(Date.UTC(2026, 10, 2, 14, 30) / 1000), -5 * 3600);
});

test('converts an Eastern wall time to the correct UTC instant on both sides of DST', () => {
  assert.equal(etWallTimeToUnix(2026, 10, 30, 9, 30), Date.UTC(2026, 9, 30, 13, 30) / 1000);
  assert.equal(etWallTimeToUnix(2026, 11, 2, 9, 30), Date.UTC(2026, 10, 2, 14, 30) / 1000);
});

test('covers PRE, REGULAR, POST, OVERNIGHT and CLOSED sessions without gaps', () => {
  const start = etWallTimeToUnix(2026, 10, 30, 0, 0);
  const end = etWallTimeToUnix(2026, 11, 1, 0, 0);
  const intervals = buildEtMarketIntervals(start, end);
  assert.ok(intervals.length >= 3);
  let previousEnd = start;
  for (const interval of intervals) {
    assert.equal(interval.start, previousEnd, 'intervals must be contiguous');
    assert.ok(interval.end > interval.start, 'interval must be forward in time');
    assert.ok(['PRE', 'REGULAR', 'POST', 'OVERNIGHT', 'CLOSED'].includes(interval.phase), `unexpected phase ${interval.phase}`);
    previousEnd = interval.end;
  }
  assert.equal(previousEnd, end);
  const regular = intervals.filter((interval) => interval.phase === 'REGULAR');
  assert.equal(regular.length, 1);
  assert.equal(regular[0].start, etWallTimeToUnix(2026, 10, 30, 9, 30));
  assert.equal(regular[0].end, etWallTimeToUnix(2026, 10, 30, 16, 0));
  assert.ok(intervals.some((interval) => interval.phase === 'POST'));
  assert.ok(intervals.some((interval) => interval.phase === 'OVERNIGHT'));
  assert.equal(intervals.find((interval) => interval.phase === 'POST').end, etWallTimeToUnix(2026, 10, 30, 17, 0));
  assert.equal(intervals.find((interval) => interval.phase === 'OVERNIGHT').end, etWallTimeToUnix(2026, 10, 30, 0, 0) + 4 * 3600);
});

test('marks NYSE holidays closed and honors the published 1pm early close', () => {
  const intervals = buildEtMarketIntervals(
    etWallTimeToUnix(2026, 11, 26, 0, 0), etWallTimeToUnix(2026, 11, 28, 0, 0),
  );
  assert.ok(intervals.some((interval) => interval.phase === 'CLOSED'
    && interval.start === etWallTimeToUnix(2026, 11, 26, 0, 0)
    && interval.end === etWallTimeToUnix(2026, 11, 26, 20, 0)));
  const regular = intervals.find((interval) => interval.phase === 'REGULAR');
  assert.equal(regular?.start, etWallTimeToUnix(2026, 11, 27, 9, 30));
  assert.equal(regular?.end, etWallTimeToUnix(2026, 11, 27, 13, 0));
  assert.ok(intervals.some((interval) => interval.phase === 'POST'
    && interval.start === etWallTimeToUnix(2026, 11, 27, 13, 0)
    && interval.end === etWallTimeToUnix(2026, 11, 27, 17, 0)));
});

test('opens the token market Sunday at 20:00 ET and closes at the Chainlink feed cutoff Friday 17:00 ET', () => {
  const start = etWallTimeToUnix(2026, 10, 30, 0, 0);
  const end = etWallTimeToUnix(2026, 11, 2, 20, 0);
  const intervals = buildEtMarketIntervals(start, end);
  assert.ok(intervals.some((interval) => interval.phase === 'CLOSED' && interval.start === etWallTimeToUnix(2026, 10, 30, 17, 0)));
  assert.ok(intervals.some((interval) => interval.phase === 'CLOSED'
    && interval.start === etWallTimeToUnix(2026, 10, 30, 17, 0)
    && interval.end === etWallTimeToUnix(2026, 11, 1, 20, 0)));
  assert.ok(intervals.some((interval) => interval.phase === 'OVERNIGHT' && interval.start === etWallTimeToUnix(2026, 11, 1, 20, 0)));
});

test('keeps the 09:30 ET open pinned to the same wall clock across the DST change', () => {
  const intervals = buildEtMarketIntervals(
    etWallTimeToUnix(2026, 10, 30, 0, 0),
    etWallTimeToUnix(2026, 11, 3, 0, 0),
  );
  const regular = intervals.filter((interval) => interval.phase === 'REGULAR');
  assert.equal(regular.length, 2);
  // 2026-10-30 is still EDT (13:30Z); 2026-11-02 is EST (14:30Z).
  assert.equal(regular[0].start, Date.UTC(2026, 9, 30, 13, 30) / 1000);
  assert.equal(regular[1].start, Date.UTC(2026, 10, 2, 14, 30) / 1000);
});

test('rejects an empty or inverted range instead of emitting a bogus calendar', () => {
  assert.throws(() => buildEtMarketIntervals(1000, 1000), /forward in time/);
  assert.throws(() => buildEtMarketIntervals(2000, 1000), /forward in time/);
});
