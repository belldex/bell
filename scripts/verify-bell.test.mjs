import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRuleReceipt,
  hookPermissionResult,
  hookFlags,
  phaseSessionLabel,
  getLogsChunked,
  isLaterSwap,
} from './verify-bell.ts';

test('extracts the low fourteen permission bits from a hook address', () => {
  assert.equal(hookFlags('0x0000000000000000000000000000000000002cc0'), 0x2cc0);
  assert.equal(hookFlags('0x0000000000000000000000000000000000003fff'), 0x3fff);
});

test('passes BELL hook mask when exit and liquidity permissions are disabled', () => {
  assert.deepEqual(hookPermissionResult('0x0000000000000000000000000000000000002cc0'), {
    flags: 0x2cc0,
    forbiddenBits: 0,
    pass: true,
  });
  assert.equal(hookPermissionResult('0x0000000000000000000000000000000000002ec1').pass, false);
});

test('labels legacy fee events from the hook policy phase at the event block', () => {
  assert.equal(phaseSessionLabel(1), 'PRE');
  assert.equal(phaseSessionLabel(2), 'REGULAR');
  assert.equal(phaseSessionLabel(3), 'POST');
  assert.equal(phaseSessionLabel(4), 'OVERNIGHT');
  assert.equal(phaseSessionLabel(5), 'CLOSED');
  assert.equal(phaseSessionLabel(9), 'UNKNOWN');
});

test('chooses the later swap within a block when the stored block is a JSON string', () => {
  const prior = { blockNumber: '100', logIndex: 3 };
  assert.equal(isLaterSwap({ blockNumber: 100n, logIndex: 4 }, prior), true);
  assert.equal(isLaterSwap({ blockNumber: 100n, logIndex: 2 }, prior), false);
  assert.equal(isLaterSwap({ blockNumber: 101n, logIndex: 0 }, prior), true);
});

test('checks recorded rule-test expectations against mined receipt status', () => {
  const revertCase = { id: 'cap', expect: 'REVERTS', status: 'DONE', error: 'TradeCapExceeded' };
  assert.deepEqual(checkRuleReceipt(revertCase, { status: 'reverted' }), {
    id: 'cap', status: 'PASS', expected: 'REVERTS', actual: 'REVERTS', error: 'TradeCapExceeded',
    errorSource: 'recorded test evidence; receipt status alone does not prove the error',
  });
  const successCase = { id: 'withdraw', expect: 'SUCCEEDS', status: 'DONE', error: null };
  assert.equal(checkRuleReceipt(successCase, { status: 'success' }).status, 'PASS');
  assert.equal(checkRuleReceipt(successCase, { status: 'reverted' }).status, 'FAIL');
  assert.equal(checkRuleReceipt({ ...revertCase, status: 'PENDING' }, null).status, 'PENDING');
});

test('does not recursively split a transport failure', async () => {
  let calls = 0;
  await assert.rejects(getLogsChunked({ getLogs: async () => { calls++; throw new Error('network disconnected'); } }, { fromBlock: 1n, toBlock: 100000n }), /RPC log scan failed/);
  assert.equal(calls, 1);
});

test('splits RPC range limits into bounded pages', async () => {
  const result = await getLogsChunked({ getLogs: async ({ fromBlock, toBlock }) => {
    if (toBlock - fromBlock > 2n) throw new Error('block range limit');
    return [{ fromBlock, toBlock }];
  } }, { fromBlock: 1n, toBlock: 8n });
  assert.equal(result.length, 4);
});
