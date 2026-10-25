import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCreateRequest, encodeCreateRequest } from '../src/create-codec.mjs';

const addr = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const config = {
  token0: addr(1), token1: addr(2), asset0: `0x${'a'.repeat(64)}`, asset1: `0x${'b'.repeat(64)}`,
  poolManager: addr(3), positionManager: addr(4), factory: addr(5), assetRegistry: addr(6),
  calendarRegistry: addr(7), safetyController: addr(8), treasuryAdapter: addr(9),
  poolClass: 0, liquidityMode: 0, referenceMode: 0, tickSpacing: 60,
  tradeCap: ['1000', '2000'], windowCap: ['4000', '8000'], closureCap: ['500', '1000'],
  policyId: `0x${'c'.repeat(64)}`,
};
const request = {
  config, salt: `0x${'d'.repeat(64)}`, nonce: '7', deadline: '1790000000', recipient: addr(10),
  sqrtPriceX96: '79228162514264337593543950336', tickLower: -120, tickUpper: 120,
  liquidity: '100000', amountMax: ['9007199254740993', '9007199254740994'], maxServiceFee: '49000000',
};

test('CreateRequest tuple encoding round-trips nested PoolConfig and large amounts losslessly', () => {
  assert.deepEqual(decodeCreateRequest(encodeCreateRequest(request)), request);
});

test('rejects unsorted tokens, invalid ticks, wrong array arity, and unsafe JS amounts', () => {
  assert.throws(() => encodeCreateRequest({ ...request, config: { ...config, token0: addr(2), token1: addr(1) } }), /sorted/i);
  assert.throws(() => encodeCreateRequest({ ...request, tickLower: 120 }), /tick/i);
  assert.throws(() => encodeCreateRequest({ ...request, amountMax: ['1'] }), /two/i);
  assert.throws(() => encodeCreateRequest({ ...request, liquidity: 100000 }), /decimal string|bigint/i);
});

test('rejects noncanonical or trailing create calldata', () => {
  const encoded = encodeCreateRequest(request);
  assert.throws(() => decodeCreateRequest(`${encoded}00`), /canonical|trailing/i);
});
