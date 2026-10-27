import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildYahooSourceSample,
  buildYahooSourceWire,
  signYahooSourceSample,
  signYahooTokenStatus,
  yahooFeedId,
} from '../src/yahoo-attestation.mjs';

const PRIVATE_KEY = `0x${'11'.repeat(32)}`;
const VERIFIER = '0x1234567890123456789012345678901234567890';
const CONFIG_HASH = `0x${'22'.repeat(32)}`;
const FEED_ID = `0x${'33'.repeat(32)}`;

test('builds a fresh regular-session sample from real Yahoo price without float rescaling', () => {
  const sample = buildYahooSourceSample({
    symbol: 'AAPL', currency: 'USD', priceRaw18: '345489990234375000000',
    observedAt: 1793029632, inputAt: 1793029632, ageSeconds: 2, phase: 'REGULAR', source: 'YAHOO_CHART_API',
  }, { feedId: FEED_ID, phaseScope: 1, nowSeconds: 1793029634 });
  assert.equal(sample.phase, 2);
  assert.equal(sample.price18, 345489990234375000000n);
  assert.equal(sample.validUntil, 1793029752n);
  assert.notEqual(sample.reportHash, `0x${'00'.repeat(32)}`);
});

test('refuses stale quotes and a Yahoo phase that does not match the configured feed', () => {
  const stale = { symbol: 'AAPL', currency: 'USD', priceRaw18: '1000000000000000000', observedAt: 1793029500, inputAt: 1793029500, ageSeconds: 134, phase: 'REGULAR', source: 'YAHOO_CHART_API' };
  assert.throws(() => buildYahooSourceSample(stale, { feedId: FEED_ID, phaseScope: 1, nowSeconds: 1793029634 }), /stale/i);
  const wrongPhase = { ...stale, observedAt: 1793029632, inputAt: 1793029632, ageSeconds: 2, phase: 'POST' };
  assert.throws(() => buildYahooSourceSample(wrongPhase, { feedId: FEED_ID, phaseScope: 1, nowSeconds: 1793029634 }), /phase mismatch/i);
});

test('signs a source-config-bound EIP-712 report with the configured reporter key', async () => {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const sample = buildYahooSourceSample({
    symbol: 'AAPL', currency: 'USD', priceRaw18: '345489990234375000000',
    observedAt: 1793029632, inputAt: 1793029632, ageSeconds: 2, phase: 'REGULAR', source: 'YAHOO_CHART_API',
  }, { feedId: FEED_ID, phaseScope: 1, nowSeconds: 1793029634 });
  const signed = await signYahooSourceSample(sample, {
    sourceConfigHash: CONFIG_HASH,
    chainId: 46630,
    verifier: VERIFIER,
    privateKey: PRIVATE_KEY,
  });
  assert.equal(signed.reporter.toLowerCase(), account.address.toLowerCase());
  assert.equal(signed.signature.length, 132);
  const recovered = await recoverTypedDataAddress({ ...signed.typedData, signature: signed.signature });
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
});

test('derives distinct deterministic feed IDs per Yahoo ticker and session scope', () => {
  const aaplRegular = yahooFeedId('AAPL', 1);
  assert.match(aaplRegular, /^0x[0-9a-f]{64}$/);
  assert.equal(aaplRegular, yahooFeedId('aapl', 1));
  assert.notEqual(aaplRegular, yahooFeedId('AAPL', 2));
  assert.notEqual(aaplRegular, yahooFeedId('TSLA', 1));
});

test('builds a block-chain-bound SourceWire compatible with the onchain schema-12 adapter', () => {
  const direct = buildYahooSourceWire({
    chainId: 4663,
    token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    verifier: '0x1234567890123456789012345678901234567890',
    verifierCodeHash: `0x${'44'.repeat(32)}`,
    phaseScope: 0,
  });
  assert.equal(direct.wire.kind, 1);
  assert.equal(direct.wire.phaseScope, 0);
  assert.equal(direct.wire.schema, 0);
  assert.equal(direct.wire.feedId, `0x${'00'.repeat(32)}`);
  assert.equal(direct.wire.priceBasis, 2);
  assert.match(direct.canonicalTokenId, /^0x[0-9a-f]{64}$/);
  assert.match(direct.sourceConfigHash, /^0x[0-9a-f]{64}$/);

  const regular = buildYahooSourceWire({
    chainId: 4663,
    token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    verifier: '0x1234567890123456789012345678901234567890',
    verifierCodeHash: `0x${'44'.repeat(32)}`,
    phaseScope: 1,
    symbol: 'AAPL',
  });
  assert.equal(regular.wire.kind, 3);
  assert.equal(regular.wire.schema, 12);
  assert.equal(regular.wire.phaseScope, 1);
  assert.notEqual(regular.wire.feedId, `0x${'00'.repeat(32)}`);
});

test('attests coherent current corporate multiplier/pause state separately from Yahoo price', async () => {
  const signed = await signYahooTokenStatus({
    token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    multiplier18: '1000000000000000000',
    pendingMultiplier18: '1000000000000000000',
    effectiveAt: '0',
    observedAt: '1793029634',
    oraclePaused: false,
    codeHash: `0x${'44'.repeat(32)}`,
  }, { chainId: 46630, verifier: VERIFIER, privateKey: PRIVATE_KEY });
  assert.equal(signed.reporter.toLowerCase(), privateKeyToAccount(PRIVATE_KEY).address.toLowerCase());
  const recovered = await recoverTypedDataAddress({ ...signed.typedData, signature: signed.signature });
  assert.equal(recovered.toLowerCase(), signed.reporter.toLowerCase());
  await assert.rejects(() => signYahooTokenStatus({
    token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', multiplier18: '1000000000000000000',
    pendingMultiplier18: '900000000000000000', effectiveAt: '0', observedAt: '1793029634',
    oraclePaused: false, codeHash: `0x${'44'.repeat(32)}`,
  }, { chainId: 46630, verifier: VERIFIER, privateKey: PRIVATE_KEY }), /inconsistent/i);
});
