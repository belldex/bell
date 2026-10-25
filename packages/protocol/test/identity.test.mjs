import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTokenId, functionSelector, hashEvmCode } from '../src/identity.mjs';
import vector from '../../test-vectors/runtime-compat.json' with { type: 'json' };

test('canonical token ID ABI-encodes chain ID and token address with domain separation by chain', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const mainnet = canonicalTokenId(4663n, address);
  assert.match(mainnet, /^0x[0-9a-f]{64}$/);
  assert.equal(canonicalTokenId(4663n, address.toUpperCase().replace('0X', '0x')), mainnet);
  assert.notEqual(canonicalTokenId(46630n, address), mainnet);
  assert.notEqual(canonicalTokenId(4663n, '0x2222222222222222222222222222222222222222'), mainnet);
});

test('matches the shared canonical token identity vector', () => {
  assert.equal(canonicalTokenId(BigInt(vector.canonicalToken.chainId), vector.canonicalToken.address), vector.canonicalToken.expectedId);
});

test('rejects invalid chain IDs and non-address token identities', () => {
  assert.throws(() => canonicalTokenId(0n, '0x1111111111111111111111111111111111111111'));
  assert.throws(() => canonicalTokenId(4663n, '0x1234'));
  assert.throws(() => canonicalTokenId(1n << 256n, '0x1111111111111111111111111111111111111111'));
});

test('formats canonical EVM selectors and runtime-code hashes for offline probes', () => {
  assert.equal(functionSelector('decimals()'), '0x313ce567');
  assert.match(functionSelector('uiMultiplier()'), /^0x[0-9a-f]{8}$/);
  assert.throws(() => functionSelector('not a function'));
  assert.match(hashEvmCode('0x6001600055'), /^0x[0-9a-f]{64}$/);
  assert.equal(hashEvmCode('0x6001600055'.toUpperCase().replace('0X', '0x')), hashEvmCode('0x6001600055'));
  assert.throws(() => hashEvmCode('0x123'));
});
