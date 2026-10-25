import test from 'node:test';
import assert from 'node:assert/strict';
import { FreshnessTrace, stalenessProfile } from '../src/freshness-trace.mjs';

test('older-than-high-water observations never refresh and are flagged', () => {
  const t = new FreshnessTrace();
  const first = t.observe({ feedId: 'f1', inputAt: 1000, reportedAt: 1000, expiresAt: 2000, now: 1100 });
  assert.deepEqual(first.regressions, []);
  const stale = t.observe({ feedId: 'f1', inputAt: 900, reportedAt: 900, expiresAt: 3000, now: 1200 });
  assert.ok(stale.regressions.includes('INPUT_OLDER_THAN_HIGH_WATER'));
});

test('degrading freshness (aging observations) is surfaced, not absorbed', () => {
  const t = new FreshnessTrace();
  t.observe({ feedId: 'f1', inputAt: 900, reportedAt: 900, expiresAt: 9000, now: 1000 });
  const later = t.observe({ feedId: 'f1', inputAt: 1900, reportedAt: 1900, expiresAt: 9000, now: 3000 });
  assert.ok(later.regressions.includes('FRESHNESS_DEGRADING'));
});

test('expired observations are flagged', () => {
  const t = new FreshnessTrace();
  const r = t.observe({ feedId: 'f1', inputAt: 100, reportedAt: 100, expiresAt: 200, now: 500 });
  assert.ok(r.regressions.includes('EXPIRED'));
});

test('high-water inputAt never moves backward across observations', () => {
  const t = new FreshnessTrace();
  t.observe({ feedId: 'f1', inputAt: 5000, reportedAt: 5000, expiresAt: 9000, now: 5000 });
  t.observe({ feedId: 'f1', inputAt: 100, reportedAt: 100, expiresAt: 9000, now: 6000 });
  assert.equal(t.highWater('f1').inputAt, 5000);
});

test('staleness profile reports per-feed max age against the policy bound', () => {
  const profile = stalenessProfile([
    { feedId: 'a', inputAt: 0, now: 30_000 },
    { feedId: 'a', inputAt: 0, now: 50_000 },
    { feedId: 'b', inputAt: 0, now: 10_000 },
  ], { maxAgeSeconds: 60 });
  const a = profile.find((p) => p.feedId === 'a');
  assert.equal(a.maxAgeSeconds, 50);
  assert.equal(a.withinPolicy, true);
  const b = stalenessProfile([{ feedId: 'b', inputAt: 0, now: 120_000 }], { maxAgeSeconds: 60 });
  assert.equal(b[0].withinPolicy, false);
});