import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewedSessionOnlyCounterasset } from './mainnet-counterasset-admission.mjs';

const review = {
  chainId: 4663,
  schemaVersion: 1,
  status: 'ADMITTED',
  token: {
    symbol: 'MEME',
    address: '0x385F4f8ae47651ce5F58F5265395a669f8281e18',
    decimals: 18,
    runtimeCodeHash: '0x' + 'ab'.repeat(32),
  },
  admissionPolicy: {
    isStock: false,
    capabilityMask: 0,
    sourceConfig: '0x',
    allowedPoolClass: 'SESSION_ONLY',
    referenceAdapter: null,
  },
};

test('builds an unpriced SESSION_ONLY counterasset only when current Mainnet token code matches the review', () => {
  const descriptor = buildReviewedSessionOnlyCounterasset({
    review,
    chainId: 4663,
    onchain: {
      symbol: 'MEME',
      address: review.token.address,
      decimals: 18,
      codeHash: review.token.runtimeCodeHash,
    },
  });
  assert.deepEqual(descriptor, {
    symbol: 'MEME',
    token: review.token.address,
    decimals: 18,
    isStock: false,
    capabilityMask: 0,
    sourceConfig: '0x',
    adapters: {},
    evidenceHash: '0xe2243d6247550381186a99e0922d91804eca97062db52e4f210ff04741fa1d2d',
  });
});

test('rejects a reviewed MEME token if its deployed code differs from the Mainnet review', () => {
  assert.throws(() => buildReviewedSessionOnlyCounterasset({
    review,
    chainId: 4663,
    onchain: { symbol: 'MEME', address: review.token.address, decimals: 18, codeHash: '0x' + 'cd'.repeat(32) },
  }), /runtime code hash differs/i);
});

test('rejects a counterasset review that grants stock or price-reference capabilities', () => {
  assert.throws(() => buildReviewedSessionOnlyCounterasset({
    review: { ...review, admissionPolicy: { ...review.admissionPolicy, capabilityMask: 2 } },
    chainId: 4663,
    onchain: { symbol: 'MEME', address: review.token.address, decimals: 18, codeHash: review.token.runtimeCodeHash },
  }), /SESSION_ONLY/i);
});
