import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAINNET_CALENDAR_PUBLICATION_LEAD_SECONDS,
  MAINNET_GOVERNANCE_MINIMUM_DELAY_SECONDS,
  MAINNET_GOVERNANCE_OPERATION_EXPIRY_SECONDS,
  planMainnetCalendarTimeline,
  planCalendarCoverageStart,
} from './mainnet-timeline.mjs';

const DAY = 86_400;
// 2026-03-01T00:00:00Z. A +7d notice and +60d coverage both stay inside UTC 2026.
const NOW = Date.UTC(2026, 2, 1, 0, 0) / 1000;

test('mainnet constants match the on-chain PolicyConstants values', () => {
  // These are the numbers CalendarRegistry/SafetyController apply when block.chainid != 46630.
  // A drift here would produce a timeline the registry rejects with ROOT_TIME.
  assert.equal(MAINNET_CALENDAR_PUBLICATION_LEAD_SECONDS, 604_800);
  assert.equal(MAINNET_GOVERNANCE_MINIMUM_DELAY_SECONDS, 172_800);
  assert.equal(MAINNET_GOVERNANCE_OPERATION_EXPIRY_SECONDS, 604_800);
});

test('coverage cannot start before the seven day publication notice', () => {
  const plan = planMainnetCalendarTimeline({ now: NOW, coverageStart: NOW + 3 * DAY, coverageDays: 60 });
  assert.equal(plan.ok, false);
  assert.ok(plan.violations.some((v) => /publication notice/.test(v)));
  assert.equal(plan.earliestCoverageStart, NOW + 7 * DAY);
});

test('a coverage start exactly at the notice deadline is accepted', () => {
  const plan = planMainnetCalendarTimeline({ now: NOW, coverageStart: NOW + 7 * DAY, coverageDays: 60 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.violations, []);
  assert.equal(plan.queueAt, NOW);
  assert.equal(plan.rootEta, NOW + 2 * DAY);
});

test('activateRoot has a usable window between the 48h ETA and coverage start', () => {
  const plan = planMainnetCalendarTimeline({ now: NOW, coverageStart: NOW + 7 * DAY, coverageDays: 60 });
  assert.equal(plan.activateRootEarliest, NOW + 2 * DAY);
  assert.equal(plan.activateRootLatest, NOW + 7 * DAY);
  assert.equal(plan.activateRootWindowSeconds, 5 * DAY);
  // The registry rejects activation at or after coverageStart, so the window is half-open.
  assert.equal(plan.activateRootLatestExclusive, true);
});

test('the operation expiry must outlive the activation window', () => {
  const plan = planMainnetCalendarTimeline({ now: NOW, coverageStart: NOW + 7 * DAY, coverageDays: 60 });
  assert.equal(plan.operationExpiry, NOW + 2 * DAY + 7 * DAY);
  assert.ok(plan.operationExpiry > plan.activateRootLatest);
  assert.equal(plan.expiryBindsWindow, false);
});

test('an expiry that binds the window narrows it and is reported, not silently accepted', () => {
  // Expiry is eta + 7d by construction, so it can only bind when coverage starts strictly later
  // than that. A 10-day notice puts coverageStart past the expiry.
  const plan = planMainnetCalendarTimeline({
    now: NOW,
    coverageStart: NOW + 10 * DAY,
    coverageDays: 30,
  });
  assert.equal(plan.expiryBindsWindow, true);
  assert.equal(plan.operationExpiry, NOW + 9 * DAY);
  assert.equal(plan.activateRootLatest, plan.operationExpiry);
  assert.equal(plan.activateRootWindowSeconds, 7 * DAY);
  assert.equal(plan.ok, true);
});

test('coverage must stay inside one UTC year because the root is single-slot per asset-year', () => {
  const lateDecember = Date.UTC(2026, 11, 20, 0, 0) / 1000;
  const plan = planMainnetCalendarTimeline({ now: lateDecember, coverageStart: lateDecember + 7 * DAY, coverageDays: 60 });
  assert.equal(plan.ok, false);
  assert.ok(plan.violations.some((v) => /UTC year/.test(v)));
});

test('the planner reports the phase the chain clock will be in at coverage start', () => {
  // 2026-03-09 is a Monday. Coverage starts 13:00 UTC = 09:00 ET (EDT, UTC-4), so the first
  // covered second is still PRE (04:00-09:30 ET). This is the leaf activateInterval will need.
  const now = Date.UTC(2026, 2, 1, 0, 0) / 1000;
  const coverageStart = Date.UTC(2026, 2, 9, 13, 0) / 1000;
  const plan = planMainnetCalendarTimeline({ now, coverageStart, coverageDays: 60 });
  assert.equal(plan.ok, true);
  assert.equal(plan.activationPhaseAtCoverageStart, 'PRE');
});

test('a zero or negative day count is rejected instead of producing an empty calendar', () => {
  assert.throws(() => planMainnetCalendarTimeline({ now: NOW, coverageStart: NOW + 7 * DAY, coverageDays: 0 }), /coverageDays/);
  assert.throws(() => planMainnetCalendarTimeline({ now: NOW, coverageStart: NOW + 7 * DAY, coverageDays: -3 }), /coverageDays/);
});

test('zero publication lead starts coverage after a short activation buffer, not at next midnight', () => {
  const now = Date.UTC(2026, 2, 1, 13, 0, 0) / 1000;
  const start = planCalendarCoverageStart({ now, noticeSeconds: 0, activationBufferSeconds: 300 });
  assert.equal(start, now + 300);
});

test('nonzero publication lead remains the lower bound for the coverage start', () => {
  const now = Date.UTC(2026, 2, 1, 13, 0, 0) / 1000;
  const start = planCalendarCoverageStart({ now, noticeSeconds: 600, activationBufferSeconds: 300 });
  assert.equal(start, now + 600);
});
