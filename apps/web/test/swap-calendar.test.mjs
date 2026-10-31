import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteSourceForPhase, phaseLabel } from '../lib/swap-calendar.mjs';

test('market-free phase uses the onchain anchor without requesting a new stock quote', () => {
  assert.equal(quoteSourceForPhase(5), 'anchor');
  assert.equal(phaseLabel(5), 'Weekend reference');
});

test('every active market session uses the onchain Chainlink feed', () => {
  for (const phase of [1, 2, 3, 4]) assert.equal(quoteSourceForPhase(phase), 'chainlink-feed');
  assert.equal(phaseLabel(4), 'Overnight');
});

test('unknown phase is unavailable instead of silently using a stale anchor', () => {
  assert.equal(quoteSourceForPhase(0), 'unavailable');
  assert.equal(quoteSourceForPhase(6), 'unavailable');
  assert.equal(phaseLabel(0), 'Unknown');
});
