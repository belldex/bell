import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteSourceForPhase, phaseLabel } from '../lib/swap-calendar.mjs';

test('market-free phase uses the onchain anchor without requesting a new stock quote', () => {
  assert.equal(quoteSourceForPhase(5), 'anchor');
  assert.equal(phaseLabel(5), 'Weekend reference');
});

test('supported market sessions continue to request fresh signed quotes', () => {
  for (const phase of [1, 2, 3]) assert.equal(quoteSourceForPhase(phase), 'signed-quote');
  assert.equal(quoteSourceForPhase(4), 'unavailable');
  assert.equal(phaseLabel(4), 'Overnight source unavailable');
});

test('unknown phase is unavailable instead of silently using a stale anchor', () => {
  assert.equal(quoteSourceForPhase(0), 'unavailable');
  assert.equal(quoteSourceForPhase(6), 'unavailable');
  assert.equal(phaseLabel(0), 'Unknown');
});
