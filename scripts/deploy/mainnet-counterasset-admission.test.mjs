import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCounterassetObservation, buildCounterassetDescriptor } from './mainnet-counterasset-admission.mjs';

const candidate = {
  symbol: 'MEME', name: 'A Meme Coin', chainId: 4663,
  token: '0x385F4f8ae47651ce5F58F5265395a669f8281e18', decimals: 18,
  tokenCodeHash: `0x${'11'.repeat(32)}`,
  implementation: '0x3Be8B97Fd0e713B5aBE0649Fa830223B6B4BC599',
  implementationCodeHash: `0x${'22'.repeat(32)}`,
  evidenceHash: `0x${'33'.repeat(32)}`,
  isStock: false, capabilityMask: 0,
};
const observed = { ...candidate, registryDescriptorId: `0x${'00'.repeat(32)}`, clone: true };

test('MEME counterasset observation must exactly match pinned chain, identity, code, implementation and registry state', () => {
  assert.deepEqual(validateCounterassetObservation(candidate, observed), { eligible: true, poolClasses: ['SESSION_ONLY'] });
  for (const override of [
    { chainId: 1 }, { symbol: 'MEME2' }, { decimals: 6 }, { tokenCodeHash: `0x${'44'.repeat(32)}` },
    { implementation: '0x0000000000000000000000000000000000000001' }, { implementationCodeHash: `0x${'55'.repeat(32)}` },
    { registryDescriptorId: `0x${'66'.repeat(32)}` }, { clone: false },
  ]) assert.throws(() => validateCounterassetObservation(candidate, { ...observed, ...override }));
});

test('counterasset descriptor has no price sources and no stock capabilities', () => {
  const descriptor = buildCounterassetDescriptor(candidate);
  assert.equal(descriptor.token, candidate.token);
  assert.equal(descriptor.isStock, false);
  assert.equal(descriptor.capabilityMask, 0);
  assert.equal(descriptor.tokenPriceAdapter, `0x${'00'.repeat(20)}`);
  assert.equal(descriptor.regularAdapter, `0x${'00'.repeat(20)}`);
  assert.equal(descriptor.expectedCodeHash, candidate.tokenCodeHash);
  assert.equal(descriptor.evidenceHash, candidate.evidenceHash);
});
