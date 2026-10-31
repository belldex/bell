import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAbiParameters, decodeFunctionData } from 'viem';
import { buildPublicLpTransaction, POSITION_MANAGER_LP_ABI } from '../src/lp-codec.mjs';

const addr = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const request = {
  operation: 'increase', account: addr(10), positionManager: addr(20), recipient: addr(11),
  tokenId: '9007199254740993', liquidity: '100000', amountMax: ['1000', '2000'],
  currency0: addr(30), currency1: addr(40), now: '10000', deadline: '10120',
};
function decode(tx) {
  const call = decodeFunctionData({ abi: POSITION_MANAGER_LP_ABI, data: tx.data });
  const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], call.args[0]);
  return { call, actions, params };
}

test('PUBLIC increase targets the pinned PM with explicit liquidity and caller-funded settlement', () => {
  const tx = buildPublicLpTransaction(request);
  assert.equal(tx.to, request.positionManager);
  assert.equal(tx.account, request.account);
  assert.equal(tx.value, 0n);
  const { call, actions, params } = decode(tx);
  assert.equal(call.functionName, 'modifyLiquidities');
  assert.equal(call.args[1], 10120n);
  assert.equal(actions, '0x000d'); // INCREASE_LIQUIDITY, SETTLE_PAIR, pinned Actions.sol
  assert.deepEqual(decodeAbiParameters([
    { type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' },
  ], params[0]), [9007199254740993n, 100000n, 1000n, 2000n, '0x']);
  assert.deepEqual(decodeAbiParameters([{ type: 'address' }, { type: 'address' }], params[1]).map(x => x.toLowerCase()), [request.currency0, request.currency1]);
});

test('remove and fee collect encode in-kind TAKE_PAIR without policy/backend input or swap actions', () => {
  for (const operation of ['remove', 'collect']) {
    const tx = buildPublicLpTransaction({ ...request, operation,
      liquidity: operation === 'collect' ? '0' : request.liquidity,
      amountMin: operation === 'collect' ? ['0', '0'] : ['1', '2'] });
    const { actions, params } = decode(tx);
    assert.equal(actions, '0x0111'); // DECREASE_LIQUIDITY, TAKE_PAIR
    const [id, liquidity, a0, a1, hookData] = decodeAbiParameters([
      { type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' },
    ], params[0]);
    assert.equal(id, 9007199254740993n);
    assert.equal(liquidity, operation === 'collect' ? 0n : 100000n);
    // Pinned PM validates principal minima, NOT collected-fee minima; never promise the latter.
    assert.equal(a0, operation === 'collect' ? 0n : 1n);
    assert.equal(a1, operation === 'collect' ? 0n : 2n);
    assert.equal(hookData, '0x');
    assert.equal(decodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], params[1])[2].toLowerCase(),request.recipient);
  }
});

test('a remove cannot be encoded with zero slippage protection', () => {
  // The pinned PM enforces amountMin as the only exit floor; both-zero means any price is accepted.
  for (const amountMin of [['0', '0'], [0n, 0n], ['0', '5'], ['5', '0']]) {
    assert.throws(() => buildPublicLpTransaction({
      ...request, operation: 'remove', liquidity: request.liquidity, amountMin,
    }), /minimum/, `expected zero minima ${amountMin.map(String).join('/')} to be rejected`);
  }
});

test('a remove with both minima set is accepted and encodes them', () => {
  const tx = buildPublicLpTransaction({
    ...request, operation: 'remove', liquidity: request.liquidity, amountMin: ['7', '9'],
  });
  const { params } = decode(tx);
  const [, , a0, a1] = decodeAbiParameters([
    { type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' },
  ], params[0]);
  assert.equal(a0, 7n);
  assert.equal(a1, 9n);
});

test('rejects unbound payer, sentinel recipients, unsafe amounts, bad deadline and nonstandard actions', () => {
  for (const bad of [
    { payer: addr(99) }, { recipient: addr(0) }, { recipient: addr(1) }, { recipient: addr(2) },
    { recipient: request.positionManager }, { account: addr(0) }, { positionManager: addr(0) },
    { tokenId: '0' }, { tokenId: 9007199254740992 }, { liquidity: 100000 }, { liquidity: '0' },
    { amountMax: ['1'] }, { amountMax: ['-1', '2'] }, { amountMax: [(1n << 128n).toString(), '2'] },
    { deadline: '9999' }, { deadline: '10121' }, { deadline: 10100 },
    { currency1: request.currency0 }, { operation: 'mint-from-deltas' }, { hookData: '0x1234' },
    { operation: 'collect', liquidity: '0', amountMin: ['1', '0'] },
  ]) assert.throws(() => buildPublicLpTransaction({ ...request, ...bad }));
});
