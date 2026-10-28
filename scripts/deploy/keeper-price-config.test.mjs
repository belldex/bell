import test from 'node:test';
import assert from 'node:assert/strict';
import { amountMaxForTokens, isNewYahooQuote, isPoolCreatePreflightReady, price18FromYahooQuote, reportValidUntil, resolveSessionRegistry, shouldContinueAfterTickError, transactionGas, yahooRegularPhaseReady, yahooSessionPhase, yahooWireForCalendarPhase, yahooWireScopeForCalendarPhase } from './keeper-price-config.mjs';

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

test('calendar phase selects the matching admitted Yahoo wire', () => {
  assert.equal(yahooWireScopeForCalendarPhase(1), 2);
  assert.equal(yahooWireScopeForCalendarPhase(2), 1);
  assert.equal(yahooWireScopeForCalendarPhase(3), 2);
  assert.equal(yahooWireScopeForCalendarPhase(4), 3);
  assert.equal(yahooWireScopeForCalendarPhase(5), null);
});

test('only accepts a fresh, phase-matching observation newer than the stored high-water', () => {
  assert.equal(isNewYahooQuote({ phase: 'PRE', observedAt: 1_100, ageSeconds: 10 }, 'PRE', 1_000), true);
  assert.equal(isNewYahooQuote({ phase: 'PRE', observedAt: 1_100, ageSeconds: 50 }, 'PRE', 1_000, 45), false);
  assert.equal(isNewYahooQuote({ phase: 'PRE', observedAt: 1_000, ageSeconds: 10 }, 'PRE', 1_000), false);
  assert.equal(isNewYahooQuote({ phase: 'REGULAR', observedAt: 1_100, ageSeconds: 10 }, 'PRE', 1_000), false);
  assert.equal(isNewYahooQuote({ phase: 'PRE', observedAt: 1_100, ageSeconds: 120 }, 'PRE', 1_000), false);
});

test('pool-create preflight requires fresh ready health before broadcasting', () => {
  assert.equal(isPoolCreatePreflightReady({ ready: true, reasonBits: 0n, validUntil: 2_000n }, 1_000), true);
  assert.equal(isPoolCreatePreflightReady({ ready: false, reasonBits: 1024n, validUntil: 0n }, 1_000), false);
  assert.equal(isPoolCreatePreflightReady({ ready: true, reasonBits: 0n, validUntil: 1_000n }, 1_000), false);
});

test('seed maxima follow normalized currency order', () => {
  assert.deepEqual(amountMaxForTokens('0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222', '0x1111111111111111111111111111111111111111', 2n, 100n), [2n, 100n]);
  assert.deepEqual(amountMaxForTokens('0x2222222222222222222222222222222222222222', '0x1111111111111111111111111111111111111111', '0x1111111111111111111111111111111111111111', 2n, 100n), [100n, 2n]);
});

test('returns the admitted wire for each active calendar phase', () => {
  const adapters = { regularWire: 'regular', regularWireHash: 'rh', extendedWire: 'extended', extendedWireHash: 'eh', overnightWire: 'overnight', overnightWireHash: 'oh' };
  assert.deepEqual(yahooWireForCalendarPhase(adapters, 1), { wire: 'extended', wireHash: 'eh' });
  assert.deepEqual(yahooWireForCalendarPhase(adapters, 2), { wire: 'regular', wireHash: 'rh' });
  assert.deepEqual(yahooWireForCalendarPhase(adapters, 3), { wire: 'extended', wireHash: 'eh' });
  assert.equal(yahooWireForCalendarPhase(adapters, 5), null);
});

test('accepts a positive explicit gas limit and defaults to RPC estimation', () => {
  assert.equal(transactionGas(undefined), undefined);
  assert.equal(transactionGas('500000'), 500000n);
  assert.throws(() => transactionGas('0'), /positive/);
});
