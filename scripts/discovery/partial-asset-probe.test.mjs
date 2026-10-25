import test from 'node:test';
import assert from 'node:assert/strict';
import * as candidateProbe from './partial-asset-probe.mjs';
const { probeAssetCandidatesAlchemy } = candidateProbe;
import { functionSelector } from '../../packages/protocol/src/identity.mjs';

const hash = `0x${'a'.repeat(64)}`;
const implementation = '0x0000000000000000000000000000000000000101';
const proxy = '0x0000000000000000000000000000000000000201';
const token = '0x0000000000000000000000000000000000000301';
const verifier = '0x0000000000000000000000000000000000000401';
const SELECTOR = {
  decimals: functionSelector('decimals()'),
  aggregator: functionSelector('aggregator()'),
  uiMultiplier: functionSelector('uiMultiplier()'),
  newUIMultiplier: functionSelector('newUIMultiplier()'),
  effectiveAt: functionSelector('effectiveAt()'),
  oraclePaused: functionSelector('oraclePaused()'),
};

function client({ provider = 'alchemy', codeMissing = false, wrongDecimals = false } = {}) {
  return {
    provider,
    async call(method, params) {
      if (method === 'eth_chainId') return '0x1237';
      if (method === 'eth_getBlockByNumber') return { number: '0x10', hash };
      if (method === 'eth_getCode') return params[0].toLowerCase() === token.toLowerCase() && codeMissing ? '0x' : '0x6001600055';
      if (method === 'eth_call') {
        const { to, data } = params[0];
        if (data === SELECTOR.decimals) {
          const decimals = wrongDecimals ? 9 : to.toLowerCase() === token.toLowerCase() ? 18 : 8;
          return `0x${decimals.toString(16).padStart(64, '0')}`;
        }
        if (data === SELECTOR.aggregator) return `0x${implementation.slice(2).padStart(64, '0')}`;
        if (data === SELECTOR.uiMultiplier || data === SELECTOR.newUIMultiplier) {
          return `0x${(10n ** 18n).toString(16).padStart(64, '0')}`;
        }
        if (data === SELECTOR.effectiveAt || data === SELECTOR.oraclePaused) return `0x${'0'.repeat(64)}`;
        throw new Error(`unexpected eth_call selector at ${to}`);
      }
      throw new Error(`unexpected RPC method ${method}`);
    },
  };
}

const candidates = () => ({
  schemaVersion: 1,
  status: 'DOCUMENTED_CANDIDATES_NOT_ADMITTED',
  network: { name: 'candidate network', chainId: 4663 },
  verifier: { address: verifier, codeHash: null, verifiedOnchain: false },
  quoteFeeds: { ETH_USD: { proxy, decimals: 8, heartbeatSeconds: 60 } },
  assets: [{
    symbol: 'TEST', token, assetId: `0x${'b'.repeat(64)}`, decimals: 18,
    directAdjustedTokenUsd: { proxy, decimals: 8, heartbeatSeconds: 60 },
    streamsV11: { REGULAR: `0x${'c'.repeat(64)}` }, schemaVersion: 11, admitted: false,
  }],
});

test('Alchemy-only candidate reads record code, feed binding and getters without admitting assets', async () => {
  const result = await probeAssetCandidatesAlchemy({ client: client(), candidates: candidates(), expectedChainId: 4663 });
  assert.equal(result.status, 'PARTIAL_ALCHEMY_ONLY');
  assert.equal(result.provider, 'alchemy');
  assert.equal(result.block.number, '16');
  assert.equal(result.assets[0].codePresent, true);
  assert.equal(result.assets[0].observedDecimals, '18');
  assert.equal(result.feeds[0].proxyCodePresent, true);
  assert.equal(result.feeds[0].implementation, implementation);
  assert.equal(result.verifier.codePresent, true);
  assert.equal(result.admissionGranted, false);
  assert.equal(result.providersAgree, false);
});

test('Alchemy-only mismatches remain explicit and never grant admission', async () => {
  const result = await probeAssetCandidatesAlchemy({
    client: client({ codeMissing: true, wrongDecimals: true }), candidates: candidates(), expectedChainId: 4663,
  });
  assert.equal(result.status, 'CANDIDATE_MISMATCH');
  assert.equal(result.assets[0].codePresent, false);
  assert.equal(result.feeds[0].decimalsMatches, false);
  assert.equal(result.admissionGranted, false);
  assert.equal(result.providersAgree, false);
});

test('wrong provider or chain fails before candidate reads', async () => {
  await assert.rejects(
    probeAssetCandidatesAlchemy({ client: { ...client(), provider: 'pinax' }, candidates: candidates(), expectedChainId: 4663 }),
    /Alchemy/i,
  );
  await assert.rejects(
    probeAssetCandidatesAlchemy({ client: { ...client(), call: async (method) => method === 'eth_chainId' ? '0x1' : null }, candidates: candidates(), expectedChainId: 4663 }),
    /chain ID/i,
  );
});

test('two-provider candidate probe checks identical reads at the agreed common block and never admits', async () => {
  const result = await candidateProbe.probeAssetCandidatesWithCrossCheck({
    primary: client({ provider: 'alchemy' }),
    secondary: client({ provider: 'pinax' }),
    candidates: candidates(),
    expectedChainId: 4663,
  });
  assert.equal(result.status, 'CROSS_CHECKED_NOT_ADMITTED');
  assert.equal(result.providersAgree, true);
  assert.equal(result.commonBlock.number, '16');
  assert.equal(result.commonBlock.hash, hash);
  assert.equal(result.candidateReadsAgree, true);
  assert.equal(result.providerResults[0].observations.assets[0].codeHash, result.providerResults[1].observations.assets[0].codeHash);
  assert.equal(result.providerResults[0].observations.feeds[0].implementation, result.providerResults[1].observations.feeds[0].implementation);
  assert.equal(result.admissionGranted, false);
});

test('provider head disagreement blocks candidate reads and admission', async () => {
  let candidateReadCount = 0;
  const primary = client({ provider: 'alchemy' });
  const secondary = client({ provider: 'pinax' });
  const originalCall = secondary.call;
  secondary.call = async (method, params) => {
    if (method === 'eth_getBlockByNumber' && params[0] !== 'latest') return { number: params[0], hash: `0x${'f'.repeat(64)}` };
    if (method === 'eth_getCode' || method === 'eth_call') candidateReadCount += 1;
    return originalCall(method, params);
  };
  const result = await candidateProbe.probeAssetCandidatesWithCrossCheck({
    primary, secondary, candidates: candidates(), expectedChainId: 4663,
  });
  assert.equal(result.status, 'PROVIDER_DISAGREEMENT');
  assert.equal(result.providersAgree, false);
  assert.equal(result.admissionGranted, false);
  assert.equal(candidateReadCount, 0);
});

test('candidate read mismatch at common block is explicit and never admitted', async () => {
  const primary = client({ provider: 'alchemy' });
  const secondary = client({ provider: 'pinax', wrongDecimals: true });
  const result = await candidateProbe.probeAssetCandidatesWithCrossCheck({
    primary, secondary, candidates: candidates(), expectedChainId: 4663,
  });
  assert.equal(result.status, 'CANDIDATE_READ_MISMATCH');
  assert.equal(result.providersAgree, true);
  assert.equal(result.candidateReadsAgree, false);
  assert.equal(result.admissionGranted, false);
});
