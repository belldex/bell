import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSwapRequest, encodeSwapRequest } from '../src/swap-codec.mjs';
import vector from '../../test-vectors/runtime-compat.json' with { type: 'json' };
import { decodeAbiParameters, keccak256, parseAbiParameters } from 'viem';

const request = {
  hook: '0x1111111111111111111111111111111111111111',
  zeroForOne: true,
  exactInput: true,
  amountSpecified: '9007199254740993',
  limitAmount: '9007199254740000',
  sqrtPriceLimitX96: '79228162514264337593543950336',
  recipient: '0x2222222222222222222222222222222222222222',
  nonce: '7',
  deadline: '1790000000',
  expectedConfigHash: `0x${'c'.repeat(64)}`,
  wrapInput: false,
  unwrapOutput: false,
  unwrapRefund: false,
  oracleUpdates: [],
};

const ZERO32 = `0x${'00'.repeat(32)}`;
const update = (assetId) => ({
  assetId,
  directSample: {
    descriptorId: ZERO32, feedId: ZERO32, phase: '0', price18: '9007199254740993000',
    observedAt: '1790000000', inputAt: '1790000001', validFrom: '1790000000',
    expiresAt: '1790000301', validUntil: '1790000120', reportHash: `0x${'ab'.repeat(32)}`,
  },
  directSignature: `0x${'cd'.repeat(65)}`, reports: ['0x1234', '0xabcd'], closeBoundaryHash: ZERO32,
});
const pullRequestAbi = parseAbiParameters('(address hook,bool zeroForOne,bool exactInput,uint128 amountSpecified,uint128 limitAmount,uint160 sqrtPriceLimitX96,address recipient,uint64 nonce,uint64 deadline,bytes32 expectedConfigHash,bool wrapInput,bool unwrapOutput,bool unwrapRefund,(bytes32 assetId,(bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash) directSample,bytes directSignature,bytes[] reports,bytes32 closeBoundaryHash)[] oracleUpdates)');

test('omitted oracle updates encode as an empty array', () => {
  const { oracleUpdates, ...legacy } = request;
  assert.deepEqual(decodeSwapRequest(encodeSwapRequest(legacy)), request);
});

for (const assetIds of [[`0x${'11'.repeat(32)}`], [`0x${'22'.repeat(32)}`, `0x${'33'.repeat(32)}`]]) {
  test(`${assetIds.length}-stock pull payload round-trips the complete signed updates and binds their bytes`, () => {
    const complete = { ...request, oracleUpdates: assetIds.map(update) };
    const encoded = encodeSwapRequest(complete);
    assert.deepEqual(decodeSwapRequest(encoded), complete);
    const [wire] = decodeAbiParameters(pullRequestAbi, encoded);
    assert.equal(wire.oracleUpdates.length, assetIds.length);
    assert.equal(wire.oracleUpdates[0].directSample.price18, 9007199254740993000n);
    assert.deepEqual(wire.oracleUpdates[0].reports, ['0x1234', '0xabcd']);
    const changed = structuredClone(complete);
    changed.oracleUpdates.at(-1).reports[1] = '0xabce';
    assert.notEqual(keccak256(encodeSwapRequest(changed)), keccak256(encoded));
  });
}

test('invalid or duplicate pull updates cannot enter calldata', () => {
  const good = update(`0x${'11'.repeat(32)}`);
  assert.throws(() => encodeSwapRequest({ ...request, oracleUpdates: [good, good] }), /duplicate/i);
  assert.throws(() => encodeSwapRequest({ ...request, oracleUpdates: [{ ...good, reports: [] }] }), /reports/i);
  assert.throws(() => encodeSwapRequest({ ...request, oracleUpdates: [{ ...good, directSample: { ...good.directSample, observedAt: 1790000000 } }] }), /decimal string|bigint/i);
});

test('pull shape checks reject malformed direct samples, signatures, excess reports and excess updates', () => {
  const good = update(`0x${'11'.repeat(32)}`);
  for (const patch of [{ descriptorId: good.assetId }, { feedId: good.assetId }, { phase: '1' }, { price18: '0' }, { observedAt: '0' }, { reportHash: ZERO32 }]) {
    assert.throws(() => encodeSwapRequest({ ...request, oracleUpdates: [{ ...good, directSample: { ...good.directSample, ...patch } }] }), /directSample/i);
  }
  assert.throws(() => encodeSwapRequest({ ...request, oracleUpdates: [{ ...good, directSignature: '0x1234' }] }), /65.byte/i);
  assert.throws(() => encodeSwapRequest({ ...request, oracleUpdates: [{ ...good, reports: Array(7).fill('0x1234') }] }), /reports/i);
  assert.throws(() => encodeSwapRequest({ ...request, oracleUpdates: ['11', '22', '33'].map((byte) => update(`0x${byte.repeat(32)}`)) }), /two|2/i);
});

test('encodes/decode round-trips uint-sized swap amounts as decimal strings', () => {
  const encoded = encodeSwapRequest(request);
  assert.deepEqual(decodeSwapRequest(encoded), request);
});

test('matches shared large-amount SwapRequest ABI encoding vector', () => {
  assert.equal(encodeSwapRequest(vector.swapRequest), vector.swapRequestEncoded);
  assert.deepEqual(decodeSwapRequest(vector.swapRequestEncoded), vector.swapRequest);
});

test('rejects unsafe JS numbers, bad widths, invalid addresses, and inconsistent native refund flags', () => {
  assert.throws(() => encodeSwapRequest({ ...request, amountSpecified: 9007199254740993 }), /decimal string|bigint/i);
  assert.throws(() => encodeSwapRequest({ ...request, amountSpecified: '0' }), /amountSpecified/i);
  assert.throws(() => encodeSwapRequest({ ...request, recipient: '0x1234' }), /address/i);
  assert.throws(() => encodeSwapRequest({ ...request, unwrapRefund: true }), /wrapInput/i);
});

test('rejects trailing or malformed calldata on decode', () => {
  const encoded = encodeSwapRequest(request);
  assert.throws(() => decodeSwapRequest(`${encoded}00`), /canonical|trailing/i);
  assert.throws(() => decodeSwapRequest('0x1234'), /decode|ABI/i);
});
