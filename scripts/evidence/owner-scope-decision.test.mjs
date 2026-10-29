// Owner decision 2026-10-29: the four-weekend availability gate and Yahoo data-rights
// gating are removed. This snapshot test pins the decision into the artifacts that the
// release gates read, so the removal cannot silently rot back into a blocker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Paths resolve from the repo root regardless of the caller's working directory,
// the same convention other scripts/evidence files use via import.meta URLs.
const brief = readFileSync(new URL('../../docs/BELL-Developer-Brief-Final.md', import.meta.url), 'utf8');
const baseline = JSON.parse(readFileSync(new URL('../../config/release-baseline.json', import.meta.url), 'utf8'));
const rights = JSON.parse(readFileSync(new URL('../../config/sources/rights-status.json', import.meta.url), 'utf8'));

test('owner decision removes the four-weekend availability gate', () => {
  assert.match(brief, /Decision 2026-10-29: the four-weekend availability gate is removed by owner decision/);
  assert.equal(baseline.mandate.fourWeekendAvailabilityGate, false);
});

test('owner decision lifts Yahoo rights gating as a production blocker', () => {
  assert.match(brief, /Decision 2026-10-29: Yahoo data-rights gating is removed as a production blocker by owner decision/);
  assert.equal(rights.gating.productionBlocker, false);
  assert.equal(rights.status, 'OWNER_ACCEPTED_RISK');
});
