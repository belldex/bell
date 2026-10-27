import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeErrorResult, encodeEventTopics, encodeAbiParameters, keccak256, parseAbi, stringToHex } from 'viem';
import {
  ASSET_QUEUED_EVENT,
  GOVERNANCE_OPERATION_EXPIRY_SECONDS,
  classifyActivateRevert,
  describeQueueState,
  formatDuration,
  parseAssetQueuedLogs
} from './activate-testnet-asset.mjs';

const REVERT_ABI = parseAbi([
  'error Unauthorized()',
  'error BadConfig(bytes32 reason)',
  'error DeadlineExpired(uint64 deadline)'
]);
const reason = (name) => keccak256(stringToHex(name));

test('parses AssetQueued logs and ignores foreign logs', () => {
  const operationId = `0x${'11'.repeat(32)}`;
  const descriptorId = `0x${'22'.repeat(32)}`;
  const topics = encodeEventTopics({
    abi: parseAbi([`event ${ASSET_QUEUED_EVENT}`]),
    eventName: 'AssetQueued',
    args: { operationId, descriptorId }
  });
  const data = encodeAbiParameters([{ type: 'uint64' }], [172800n]);
  const parsed = parseAssetQueuedLogs([
    { topics, data, blockNumber: 42n },
    { topics: ['0x' + '00'.repeat(32)], data: '0x', blockNumber: 43n }
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].operationId, operationId);
  assert.equal(parsed[0].descriptorId, descriptorId);
  assert.equal(parsed[0].eta, 172800n);
  assert.equal(parsed[0].blockNumber, 42n);
});

test('queue lifecycle: pending, ready, expired, activated', () => {
  const eta = 1_000_000;
  const expiry = eta + GOVERNANCE_OPERATION_EXPIRY_SECONDS;
  assert.deepEqual(describeQueueState({ eta, expiry, nowSeconds: eta - 60 }), {
    state: 'PENDING',
    secondsRemaining: 60
  });
  assert.equal(describeQueueState({ eta, expiry, nowSeconds: eta }).state, 'READY');
  assert.equal(describeQueueState({ eta, expiry, nowSeconds: expiry }).state, 'READY');
  assert.equal(describeQueueState({ eta, expiry, nowSeconds: expiry + 1 }).state, 'EXPIRED');
  assert.equal(describeQueueState({ eta, expiry, nowSeconds: eta - 60, activated: true }).state, 'ACTIVATED');
  assert.equal(describeQueueState({ eta: NaN, nowSeconds: 1 }).state, 'UNKNOWN');
});

test('classifies activateAsset reverts', () => {
  assert.equal(
    classifyActivateRevert(encodeErrorResult({ abi: REVERT_ABI, errorName: 'BadConfig', args: [reason('TIMELOCK')] })),
    'TIMELOCK'
  );
  assert.equal(
    classifyActivateRevert(encodeErrorResult({ abi: REVERT_ABI, errorName: 'BadConfig', args: [reason('ASSET_OPERATION')] })),
    'ALREADY_DONE_OR_CANCELLED'
  );
  assert.equal(
    classifyActivateRevert(encodeErrorResult({ abi: REVERT_ABI, errorName: 'BadConfig', args: [reason('ASSET_CHANGED')] })),
    'TOKEN_CHANGED'
  );
  assert.equal(classifyActivateRevert(encodeErrorResult({ abi: REVERT_ABI, errorName: 'DeadlineExpired', args: [7n] })), 'EXPIRED');
  assert.equal(classifyActivateRevert(encodeErrorResult({ abi: REVERT_ABI, errorName: 'Unauthorized', args: [] })), 'UNAUTHORIZED');
  assert.equal(classifyActivateRevert('0xdeadbeef'), 'UNKNOWN');
  assert.equal(classifyActivateRevert(undefined), 'UNKNOWN');
});

test('formats the remaining timelock in human units', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(59), '0m');
  assert.equal(formatDuration(172800), '2d');
  assert.equal(formatDuration(172800 + 3600 + 120), '2d 1h 2m');
});
