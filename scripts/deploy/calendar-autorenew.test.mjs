import test from 'node:test';
import assert from 'node:assert/strict';
import { nextAction, RENEW_WITHIN_SECONDS } from './calendar-autorenew.mjs';

const NOW = 1_800_000_000;
const day = 86_400;
const active = (over = {}) => ({ stage: 'INTERVAL_ACTIVE', coverageStart: NOW - 10 * day, coverageEnd: NOW + 60 * day, ...over });

test('an active root with more than 30 days left is left alone, and one with less is renewed', () => {
  assert.equal(nextAction(active(), NOW).action, 'idle');
  assert.equal(nextAction(active({ coverageEnd: NOW + RENEW_WITHIN_SECONDS - 1 }), NOW).action, 'queue');
  assert.equal(nextAction(active({ coverageEnd: NOW + 5 * day }), NOW).action, 'queue');
});

test('the governance step waits for its ETA and then executes', () => {
  const s = { stage: 'GOVERNANCE_QUEUED', coverageStart: NOW + 20 * day, coverageEnd: NOW + 380 * day, governanceEta: NOW + 600 };
  assert.equal(nextAction(s, NOW).action, 'wait');
  assert.equal(nextAction(s, NOW + 601).action, 'execute-governance');
});

test('the root step waits for its ETA, activates, and gives up loudly when the window is gone', () => {
  const s = { stage: 'QUEUED', coverageStart: NOW + 20 * day, coverageEnd: NOW + 380 * day, rootEta: NOW + 600, rootExpiry: NOW + 7 * day };
  assert.equal(nextAction(s, NOW).action, 'wait');
  assert.equal(nextAction(s, NOW + 601).action, 'activate-root');
  assert.equal(nextAction(s, NOW + 8 * day).action, 'alert');
  assert.equal(nextAction({ ...s, coverageStart: NOW - 1, rootExpiry: NOW + 9 * day }, NOW + 601).action, 'alert');
});

test('a next root that is active waits for its start, then its first interval is activated', () => {
  const s = { stage: 'ROOT_ACTIVE', coverageStart: NOW + 5 * day, coverageEnd: NOW + 370 * day };
  assert.equal(nextAction(s, NOW).action, 'wait');
  assert.equal(nextAction({ ...s, coverageStart: NOW - 1 }, NOW).action, 'activate-interval');
});

test('an ended root with nothing after it, a missing state and an unknown stage all alert', () => {
  assert.equal(nextAction(active({ coverageEnd: NOW - 1 }), NOW).action, 'alert');
  assert.equal(nextAction(null, NOW).action, 'alert');
  assert.equal(nextAction({ stage: 'WHAT', coverageStart: 0, coverageEnd: 1 }, NOW).action, 'alert');
});
