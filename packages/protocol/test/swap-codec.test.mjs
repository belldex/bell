import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSwapRequest, encodeSwapRequest } from '../src/swap-codec.mjs';
import vector from '../../test-vectors/runtime-compat.json' with { type: 'json' };

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
};

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
