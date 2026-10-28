import test from 'node:test';
import assert from 'node:assert/strict';
import { price18FromYahooQuote, reportValidUntil, resolveSessionRegistry, shouldContinueAfterTickError, yahooRegularPhaseReady, yahooSessionPhase } from './keeper-price-config.mjs';

test('uses the current deployment manifest when no registry override is set', () => {
  assert.equal(
    resolveSessionRegistry({}, { sessionRegistry: '0x1de6199618ddb2b5fdb869113e4b906628db168e' }),
    '0x1de6199618ddb2b5fdb869113e4b906628db168e',
  );
});

test('allows an explicit session registry override', () => {
  assert.equal(
    resolveSessionRegistry({ BELL_SESSION_REGISTRY: '0x1111111111111111111111111111111111111111' }, { sessionRegistry: '0x2222222222222222222222222222222222222222' }),
    '0x1111111111111111111111111111111111111111',
  );
});

test('only stale Yahoo source errors continue the loop', () => {
  assert.equal(shouldContinueAfterTickError({ code: 'STALE_SOURCE' }), true);
  assert.equal(shouldContinueAfterTickError(new Error('insufficient funds')), false);
});

test('maps the Yahoo parser priceRaw18 field to the keeper price', () => {
  assert.equal(price18FromYahooQuote({ priceRaw18: '250000000000000000000' }), 250000000000000000000n);
});

test('caps report validity at receipt and market-observation freshness deadlines', () => {
  assert.equal(reportValidUntil(1_000, 950), 1_069);
  assert.equal(reportValidUntil(1_000, 980), 1_099);
  assert.throws(() => reportValidUntil(1_000, 880), /no remaining validity/);
});

test('Yahoo phase maps only to the admitted calendar/feed phases', () => {
  assert.equal(yahooRegularPhaseReady({ phase: 'REGULAR' }), true);
  assert.equal(yahooRegularPhaseReady({ phase: 'PRE' }), false);
  assert.equal(yahooRegularPhaseReady({ phase: 'POST' }), false);
  assert.equal(yahooSessionPhase('REGULAR'), 2);
  assert.equal(yahooSessionPhase('PRE'), 1);
  assert.equal(yahooSessionPhase('POST'), 3);
  assert.equal(yahooSessionPhase('CLOSED'), null);
});
