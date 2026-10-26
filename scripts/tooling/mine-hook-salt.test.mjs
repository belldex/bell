import test from 'node:test';
import assert from 'node:assert/strict';
import { hashEvmCode } from '../../packages/protocol/src/identity.mjs';
import { mineHookSalt } from './mine-hook-salt.mjs';

const input = {
  chainId: 4663n,
  factory: '0x1111111111111111111111111111111111111111',
  creator: '0x2222222222222222222222222222222222222222',
  deployer: '0x5555555555555555555555555555555555555555',
  nonce: 7n,
  baseSalt: `0x${'33'.repeat(32)}`,
  initCodeHash: `0x${'44'.repeat(32)}`,
  maxAttempts: 100_000,
};

function word(value) { return BigInt(value).toString(16).padStart(64, '0'); }
function addressWord(value) { return value.slice(2).toLowerCase().padStart(64, '0'); }

test('mines a deterministic request salt matching the factory namespace and CREATE2 address bits', () => {
  const result = mineHookSalt(input);
  assert.ok(result.attempts >= 1 && result.attempts <= input.maxAttempts);
  assert.match(result.requestSalt, /^0x[0-9a-f]{64}$/);
  assert.match(result.create2Salt, /^0x[0-9a-f]{64}$/);
  assert.match(result.hook, /^0x[0-9a-f]{40}$/);
  assert.equal(Number(BigInt(result.hook) & 0x3fffn), 0x2cc0);
  assert.deepEqual(mineHookSalt(input), result);

  const requestSalt = hashEvmCode(`0x${input.baseSalt.slice(2)}${word(result.counter)}`);
  assert.equal(result.requestSalt, requestSalt);
  const create2Salt = hashEvmCode(`0x${word(input.chainId)}${addressWord(input.factory)}${addressWord(input.creator)}${word(input.nonce)}${result.requestSalt.slice(2)}`);
  assert.equal(result.create2Salt, create2Salt);
  const hook = hashEvmCode(`0xff${input.deployer.slice(2).toLowerCase()}${create2Salt.slice(2)}${input.initCodeHash.slice(2)}`).slice(-40);
  assert.equal(result.hook, `0x${hook}`);
});

test('rejects malformed namespaces and unbounded search inputs', () => {
  assert.throws(() => mineHookSalt({ ...input, chainId: 0n }), /chainId/i);
  assert.throws(() => mineHookSalt({ ...input, chainId: 9007199254740993 }), /chainId/i);
  assert.throws(() => mineHookSalt({ ...input, nonce: 7 }), /nonce/i);
  assert.throws(() => mineHookSalt({ ...input, creator: '0x1234' }), /creator/i);
  assert.throws(() => mineHookSalt({ ...input, baseSalt: '0x12' }), /baseSalt/i);
  assert.throws(() => mineHookSalt({ ...input, nonce: 1n << 64n }), /nonce/i);
  assert.throws(() => mineHookSalt({ ...input, maxAttempts: 0 }), /maxAttempts/i);
  assert.throws(() => mineHookSalt({ ...input, maxAttempts: 10_000_001 }), /maxAttempts/i);
});

test('reports exhaustion instead of returning a non-permissioned address', () => {
  assert.throws(() => mineHookSalt({ ...input, maxAttempts: 1 }), /No hook salt found/i);
});
