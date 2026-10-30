import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdmittedPair, poolClassesForPair, mineHookSalt } from '../lib/mainnet-create-helpers.mjs';
import { mineHookSalt as mineCanonicalHookSalt } from '../../../scripts/tooling/mine-hook-salt.mjs';

const address = (byte) => `0x${byte.repeat(40)}`;
const word = (byte) => `0x${byte.repeat(64)}`;
const queue = {
  activationPending: false,
  stocks: {
    AAPL: { symbol: 'AAPL', token: address('a'), descriptorId: word('1'), isStock: true, active: true },
    NVDA: { symbol: 'NVDA', token: address('b'), descriptorId: word('2'), isStock: true, active: true },
  },
  usdg: { symbol: 'USDG', token: address('c'), descriptorId: word('3'), isStock: false, active: true },
};

test('resolves only active admitted Mainnet pair and preserves descriptor with sorted token', () => {
  const pair = resolveAdmittedPair({ stockSymbol: 'AAPL', counterSymbol: 'USDG', assetQueue: queue });
  assert.equal(pair.legs.length, 2);
  assert.deepEqual(pair.legs.map((leg) => leg.token), [address('a'), address('c')]);
  assert.deepEqual(pair.legs.map((leg) => leg.assetId), [word('1'), word('3')]);
  assert.throws(() => resolveAdmittedPair({ stockSymbol: 'AAPL', counterSymbol: 'MSFT', assetQueue: queue }), /admitted/i);
  assert.throws(() => resolveAdmittedPair({ stockSymbol: 'AAPL', counterSymbol: 'AAPL', assetQueue: queue }), /distinct/i);
  assert.throws(() => resolveAdmittedPair({ stockSymbol: 'AAPL', counterSymbol: 'USDG', assetQueue: { ...queue, activationPending: true } }), /pending/i);
});

test('exposes only pool classes supported by the selected asset pair', () => {
  const refs = { AAPL: address('d'), NVDA: address('e'), USDG: address('f') };
  assert.deepEqual(poolClassesForPair(resolveAdmittedPair({ stockSymbol: 'AAPL', counterSymbol: 'USDG', assetQueue: queue }), refs), [0, 1]);
  assert.deepEqual(poolClassesForPair(resolveAdmittedPair({ stockSymbol: 'AAPL', counterSymbol: 'NVDA', assetQueue: queue }), refs), [0]);
  assert.deepEqual(poolClassesForPair(resolveAdmittedPair({ stockSymbol: 'AAPL', counterSymbol: 'USDG', assetQueue: queue }), { AAPL: address('d') }), [1]);
});

test('browser salt miner returns a hook address with the deployed BELL permission mask', () => {
  const result = mineHookSalt({ chainId: 4663n, factory: address('1'), creator: address('2'), deployer: address('3'), nonce: 0n, baseSalt: word('4'), initCodeHash: word('5'), maxAttempts: 100_000 });
  assert.equal(result.hookFlags, '0x2cc0');
  assert.equal(BigInt(result.hook) & 0x3fffn, 0x2cc0n);
  assert.ok(result.attempts > 0 && result.attempts <= 100_000);
  assert.deepEqual(result, mineCanonicalHookSalt({ chainId: 4663n, factory: address('1'), creator: address('2'), deployer: address('3'), nonce: 0n, baseSalt: word('4'), initCodeHash: word('5'), maxAttempts: 100_000 }));
});
