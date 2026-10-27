import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { signYahooTokenStatus } from '../src/yahoo-attestation.mjs';
import { preflightYahooMainnet } from '../src/yahoo-mainnet-preflight.mjs';

const ADDRESS = '0x1234567890123456789012345678901234567890';
const REPORTER_PK = `0x${'11'.repeat(32)}`;
const REPORTER = privateKeyToAccount(REPORTER_PK).address;
const H = `0x${'11'.repeat(32)}`;

function chartPayload(now) {
  return { chart: { error: null, result: [{
    meta: { symbol: 'AAPL', currency: 'USD', currentTradingPeriod: { regular: { start: now - 100, end: now + 1000 } } },
    timestamp: [now - 2],
    indicators: { quote: [{ close: [345.25] }] },
  }] } };
}

test('Mainnet Yahoo preflight checks deployed adapter and verifier then only reads pinned report acceptance', async () => {
  const now = 1793032200;
  const calls = [];
  const client = {
    getChainId: async () => 4663,
    getBlock: async () => ({ number: 99n, hash: H }),
    getBytecode: async ({ address }) => address === ADDRESS || address === '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9' ? '0x6001' : '0x',
    readContract: async (request) => {
      calls.push(request);
      if (request.functionName === 'recoverSigner') return REPORTER;
      if (request.functionName === 'recoverTokenStatusSigner') return REPORTER;
      if (request.functionName === 'digest') return H;
      if (request.functionName === 'uiMultiplier') return 1_000_000_000_000_000_000n;
      if (request.functionName === 'newUIMultiplier') return 1_000_000_000_000_000_000n;
      if (request.functionName === 'effectiveAt') return 0n;
      if (request.functionName === 'oraclePaused') return false;
      if (request.functionName === 'tokenSnapshotDigest') {
        const [token, multiplier18, pendingMultiplier18, effectiveAt, observedAt, oraclePaused, codeHash] = request.args;
        return (await signYahooTokenStatus({ token, multiplier18, pendingMultiplier18, effectiveAt, observedAt, oraclePaused, codeHash }, {
          chainId: 4663, verifier: ADDRESS, privateKey: REPORTER_PK,
        })).digest;
      }
      if (request.functionName === 'previewDirect') return [true, BigInt(now + 118)];
      if (request.functionName === 'verify') return true;
      throw new Error(`unexpected ${request.functionName}`);
    },
  };
  const result = await preflightYahooMainnet({
    symbol: 'AAPL', token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    adapterAddress: ADDRESS,
    publicRpcUrl: 'https://unused.invalid', client, reporterPrivateKey: REPORTER_PK,
    verifierAddress: ADDRESS, sourceConfigHash: H, expectedReporter: REPORTER,
    nowSeconds: now, fetchImpl: async () => new Response(JSON.stringify(chartPayload(now))),
  });
  assert.equal(result.mode, 'MAINNET_READ_ONLY_PREFLIGHT_NO_BROADCAST');
  assert.equal(result.adapterAcceptsAtPinnedBlock, true);
  assert.equal(result.signatureValidAtPinnedBlock, true);
  assert.equal(result.broadcasted, false);
  assert.ok(calls.filter((call) => ['recoverSigner', 'digest', 'previewDirect', 'verify', 'tokenSnapshotDigest', 'recoverTokenStatusSigner'].includes(call.functionName))
    .every((call) => call.blockNumber === 99n));
});

test('Mainnet Yahoo preflight rejects missing adapter deployment before quote or signature flow', async () => {
  const client = {
    getChainId: async () => 4663,
    getBlock: async () => ({ number: 99n, hash: H }),
    getBytecode: async () => '0x',
    readContract: async () => { throw new Error('must not proceed'); },
  };
  await assert.rejects(() => preflightYahooMainnet({
    symbol: 'AAPL', token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    adapterAddress: ADDRESS,
    publicRpcUrl: 'https://unused.invalid', client, reporterPrivateKey: `0x${'11'.repeat(32)}`,
    verifierAddress: ADDRESS, sourceConfigHash: H, expectedReporter: ADDRESS,
    nowSeconds: 1793032200, fetchImpl: async () => new Response('{}'),
  }), /YAHOO_ADAPTER_NOT_DEPLOYED/);
});
