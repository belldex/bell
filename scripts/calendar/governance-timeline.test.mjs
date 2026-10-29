import test from 'node:test';
import assert from 'node:assert/strict';
import { planGovernanceOperation } from './mainnet-timeline.mjs';

const DAY = 86_400;
const NOW = Date.UTC(2026, 2, 1, 0, 0) / 1000;

test('an asset queue is executable after 48h and expires after another 7 days', () => {
  const plan = planGovernanceOperation({ now: NOW });
  assert.equal(plan.ok, true);
  assert.equal(plan.eta, NOW + 2 * DAY);
  assert.equal(plan.expiry, NOW + 9 * DAY);
  assert.equal(plan.earliest, NOW + 2 * DAY);
  assert.equal(plan.latest, NOW + 9 * DAY);
  assert.equal(plan.windowSeconds, 7 * DAY);
});

test('activation at the ETA is inside the window and one second early is not', () => {
  const plan = planGovernanceOperation({ now: NOW });
  assert.equal(plan.isExecutableAt(plan.eta), true);
  assert.equal(plan.isExecutableAt(plan.eta - 1), false);
  // AssetRegistry rejects currentTime > expiry, so the expiry second itself is still allowed.
  assert.equal(plan.isExecutableAt(plan.expiry), true);
  assert.equal(plan.isExecutableAt(plan.expiry + 1), false);
});

test('a pending operation reports how long is left instead of just failing', () => {
  const plan = planGovernanceOperation({ now: NOW });
  const waiting = plan.describe(NOW + 3600);
  assert.equal(waiting.state, 'WAITING');
  assert.equal(waiting.secondsRemaining, 2 * DAY - 3600);
  assert.equal(plan.describe(NOW + 3 * DAY).state, 'EXECUTABLE');
  assert.equal(plan.describe(NOW + 10 * DAY).state, 'EXPIRED');
});

test('the planner refuses a non-positive delay instead of pretending it is instant', () => {
  assert.throws(() => planGovernanceOperation({ now: NOW, delaySeconds: 0 }), /delaySeconds/);
  assert.throws(() => planGovernanceOperation({ now: NOW, delaySeconds: -1 }), /delaySeconds/);
});
