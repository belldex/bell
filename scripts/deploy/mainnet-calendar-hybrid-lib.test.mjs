import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarRootGovernanceCall, GOVERNANCE_ROLE, QUEUE_GOVERNANCE_CALL_ACTION } from './mainnet-calendar-hybrid-lib.mjs';

const BASE = {
  calendarRegistry: '0x0000000000000000000000000000000000000011',
  assetId: `0x${'11'.repeat(32)}`,
  metadata: {
    root: `0x${'22'.repeat(32)}`, leafCount: 12,
    coverageStart: 1_800_000_000n, coverageEnd: 1_805_000_000n,
    datasetHash: `0x${'33'.repeat(32)}`,
  },
};

test('builds the exact calendar queue calldata and HybridAuth role action', () => {
  const action = buildCalendarRootGovernanceCall(BASE);
  assert.equal(action.target, BASE.calendarRegistry);
  assert.match(action.callData, /^0x[\da-f]+$/i);
  assert.equal(action.callData.slice(0, 10), '0x556d038d');
  assert.equal(action.role, GOVERNANCE_ROLE);
  assert.equal(action.action, QUEUE_GOVERNANCE_CALL_ACTION);
  assert.match(action.payloadHash, /^0x[\da-f]{64}$/i);
});

test('binds the signed payload to the exact asset and calendar metadata', () => {
  const baseline = buildCalendarRootGovernanceCall(BASE).payloadHash;
  assert.notEqual(buildCalendarRootGovernanceCall({ ...BASE, assetId: `0x${'44'.repeat(32)}` }).payloadHash, baseline);
  assert.notEqual(buildCalendarRootGovernanceCall({
    ...BASE, metadata: { ...BASE.metadata, coverageStart: BASE.metadata.coverageStart + 1n },
  }).payloadHash, baseline);
});
