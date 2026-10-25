import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveUiState, UI_STATES, exitGuideAvailable } from '../src/ui-state.mjs';

test('no wallet dominates: CONNECT_WALLET before anything else', () => {
  assert.equal(deriveUiState({ tx: { state: 'PENDING' }, quote: { expired: true } }).state, UI_STATES.CONNECT_WALLET);
});

test('wrong chain blocks before quote/tx surfaces', () => {
  const s = deriveUiState({ wallet: { connected: true, chainIdOk: false }, tx: { state: 'FINALIZED' } });
  assert.equal(s.state, UI_STATES.WRONG_CHAIN);
  assert.equal(s.severity, 'blocking');
});

test('wallet rejection is an action state, not a blocking dead end', () => {
  const s = deriveUiState({ wallet: { connected: true, chainIdOk: true, lastActionRejected: true } });
  assert.equal(s.state, UI_STATES.WALLET_REJECTED);
  assert.equal(s.severity, 'action');
});

test('tx lifecycle maps one-to-one onto the plan §8.5 states', () => {
  const cases = {
    PENDING: UI_STATES.TX_PENDING,
    PROVISIONAL: UI_STATES.TX_PENDING,
    REPLACED: UI_STATES.TX_REPLACED,
    REVERTED: UI_STATES.TX_REVERTED,
    CONFIRMED_UNFINALIZED: UI_STATES.CONFIRMED_UNFINALIZED,
    FINALIZED: UI_STATES.FINALIZED,
    ORPHANED: UI_STATES.ORPHANED,
  };
  for (const [txState, expected] of Object.entries(cases)) {
    const s = deriveUiState({ wallet: { connected: true, chainIdOk: true }, tx: { state: txState }, quote: { expired: true } });
    assert.equal(s.state, expected);
  }
});

test('money in flight is never downgraded to a READY warning', () => {
  const s = deriveUiState({ wallet: { connected: true, chainIdOk: true }, tx: { state: 'PENDING' }, index: { lagging: true }, quota: { exhausted: true } });
  assert.equal(s.state, UI_STATES.TX_PENDING);
  assert.equal(s.severity, 'progress');
});

test('quote expiry and policy blocks rank above infra degradations', () => {
  const expired = deriveUiState({ wallet: { connected: true, chainIdOk: true }, quote: { expired: true }, index: { lagging: true } });
  assert.equal(expired.state, UI_STATES.QUOTE_EXPIRED);
  const blocked = deriveUiState({ wallet: { connected: true, chainIdOk: true }, quote: { policyBlocked: true }, source: { unavailable: true } });
  assert.equal(blocked.state, UI_STATES.POLICY_BLOCKED);
  assert.equal(blocked.severity, 'blocking');
});

test('approval pending is visible before infra warnings', () => {
  const s = deriveUiState({ wallet: { connected: true, chainIdOk: true }, quote: { approvalPending: true }, quota: { exhausted: true } });
  assert.equal(s.state, UI_STATES.APPROVAL_PENDING);
});

test('infra degradations are warnings, not blockers; exit guide stays available', () => {
  for (const input of [
    { index: { lagging: true } },
    { source: { unavailable: true } },
    { quota: { exhausted: true } },
    { backup: { degraded: true } },
  ]) {
    const s = deriveUiState({ wallet: { connected: true, chainIdOk: true }, ...input });
    assert.equal(s.warning, true);
    assert.equal(exitGuideAvailable(s), true);
  }
  assert.equal(deriveUiState({ wallet: { connected: true, chainIdOk: true }, source: { unavailable: true } }).state, UI_STATES.SOURCE_UNAVAILABLE);
  assert.equal(deriveUiState({ wallet: { connected: true, chainIdOk: true }, quota: { exhausted: true } }).state, UI_STATES.QUOTA_EXHAUSTED);
});

test('API down never blanks the screen: degraded state is not blocking', () => {
  const s = deriveUiState({ wallet: { connected: true, chainIdOk: true }, index: { lagging: true }, source: { unavailable: true }, backup: { degraded: true } });
  assert.equal(s.severity, 'warning');
  assert.equal(exitGuideAvailable(s), true);
});

test('loading only appears when nothing else demands attention', () => {
  assert.equal(deriveUiState({ wallet: { connected: true, chainIdOk: true }, quote: { loading: true } }).state, UI_STATES.LOADING);
  assert.equal(deriveUiState({ wallet: { connected: true, chainIdOk: true } }).state, UI_STATES.READY);
});

test('the full plan §8.5 state list is represented', () => {
  assert.equal(Object.keys(UI_STATES).length, 18);
});