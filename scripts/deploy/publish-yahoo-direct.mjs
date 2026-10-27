#!/usr/bin/env node
// Publish a fresh reporter-signed direct Yahoo quote to the deployed WETH adapter.
// Waits (bounded) for the market window to produce a fresh candle instead of failing immediately.
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildYahooSourceSample,
  signYahooSourceSample,
} from '../../packages/protocol/src/yahoo-attestation.mjs';
import { fetchYahooChartQuote } from '../../packages/protocol/src/yahoo-quote.mjs';

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
const env = loadEnv(readFileSync('.env', 'utf8'));
const pk = env.YAHOO_REPORTER_PRIVATE_KEY;
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS;
const adapter = process.argv.find((a) => a.startsWith('--adapter='))?.slice(10);
const sourceConfigHash = process.argv.find((a) => a.startsWith('--wire='))?.slice(7);
const waitMs = Number(process.argv.find((a) => a.startsWith('--wait-minutes='))?.slice(15) ?? 45) * 60_000;
// AAPL mainnet canonical stock token; its live uiMultiplier converts the underlying USD quote
// into the adjusted token price the direct adapter publishes.
const AAPL_MAINNET = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9';
const token = AAPL_MAINNET;
if (!pk || !verifier || !adapter || !sourceConfigHash) {
  throw new Error('requires YAHOO_REPORTER_PRIVATE_KEY, YAHOO_SOURCE_VERIFIER_ADDRESS in .env and --adapter=<addr> --wire=<hash>');
}

const mainnetRpc = env.RH_MAINNET_RPC_PRIMARY;
const mainnet = createPublicClient({ transport: http(mainnetRpc) });
const multiplier18 = (await mainnet.readContract({
  address: token,
  abi: [{ type: 'function', name: 'uiMultiplier', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
  functionName: 'uiMultiplier',
})).toString();
console.log('mainnet uiMultiplier:', multiplier18);

const deadline = Date.now() + waitMs;
let quote = null;
let lastError = null;
// Yahoo's CDN serves the chart response from a ~10 minute cache, so a 120-second freshness policy
// cannot be met by polling the same URL. Add a per-request cache-buster that Yahoo ignores so each
// poll hits a fresh CDN key and the newest premarket candle appears as soon as Yahoo publishes it.
async function fetchFreshYahoo() {
  // query1 serves uncached premarket candles; query2 lags behind a CDN cache of ~10 minutes.
  const url = new URL('https://query1.finance.yahoo.com/v8/finance/chart/AAPL');
  url.searchParams.set('interval', '1m');
  url.searchParams.set('range', '1d');
  url.searchParams.set('includePrePost', 'true');
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', accept: 'application/json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Yahoo chart returned HTTP ${response.status}`);
  const { parseYahooChartQuote } = await import('../../packages/protocol/src/yahoo-quote.mjs');
  return parseYahooChartQuote(await response.json(), { symbol: 'AAPL', nowSeconds: Math.floor(Date.now() / 1000), maxAgeSeconds: 120 });
}
while (!quote && Date.now() < deadline) {
  try {
    quote = await fetchFreshYahoo();
  } catch (error) {
    lastError = error.message;
    process.stdout.write(`waiting for fresh Yahoo candle (${error.message}); retrying in 20s...\n`);
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
}
if (!quote) throw new Error(`no fresh Yahoo quote within wait window; last error: ${lastError}`);

const sample = buildYahooSourceSample(quote, {
  feedId: `0x${'00'.repeat(32)}`,
  phaseScope: 0,
  nowSeconds: Math.floor(Date.now() / 1000),
  tokenMultiplier18: multiplier18,
});
// The verifier binds its EIP-712 domain to its own deployment chain, so the rehearsal signature
// must use the testnet chainId even though the canonical token identity is mainnet.
const verifierChainId = 46630;
const signed = await signYahooSourceSample(sample, { sourceConfigHash, chainId: verifierChainId, verifier, privateKey: pk });
console.log('signed report ready. price18:', sample.price18.toString(), 'observedAt:', sample.observedAt.toString(), 'age:', quote.ageSeconds + 's', 'chainId:', verifierChainId);

// Rehearsal broadcast targets the testnet adapter through the testnet RPC (chainId is bound per-verifier
// deployment; this script publishes to the testnet adapter deployed for chainId-4663 canonical identity).
const testnetRpc = env.RH_TESTNET_RPC_PRIMARY;
const reporterAccount = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const publicClient = createPublicClient({ transport: http(testnetRpc) });
const walletClient = createWalletClient({ account: reporterAccount, transport: http(testnetRpc) });
const chainId = await publicClient.getChainId();
console.log('broadcast target chain:', chainId, 'adapter:', adapter);
const hash = await walletClient.writeContract({
  address: adapter,
  abi: [{ type: 'function', name: 'publishDirect', stateMutability: 'nonpayable', inputs: [
    { name: 'sample', type: 'tuple', components: [
      { name: 'descriptorId', type: 'bytes32' }, { name: 'feedId', type: 'bytes32' }, { name: 'phase', type: 'uint8' },
      { name: 'price18', type: 'uint128' }, { name: 'observedAt', type: 'uint64' }, { name: 'inputAt', type: 'uint64' },
      { name: 'validFrom', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
      { name: 'reportHash', type: 'bytes32' },
    ] },
    { name: 'signature', type: 'bytes' },
  ], outputs: [] }],
  functionName: 'publishDirect',
  args: [{
    descriptorId: sample.descriptorId, feedId: sample.feedId, phase: sample.phase,
    price18: sample.price18, observedAt: sample.observedAt, inputAt: sample.inputAt,
    validFrom: sample.validFrom, expiresAt: sample.expiresAt, validUntil: sample.validUntil,
    reportHash: sample.reportHash,
  }, signed.signature],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('publishDirect tx:', hash, 'status:', receipt.status, 'block:', receipt.blockNumber.toString());
if (receipt.status !== 'success') throw new Error('publishDirect reverted');
const stored = await publicClient.readContract({ address: adapter, abi: [{
  type: 'function', name: 'readCurrent', stateMutability: 'view', inputs: [], outputs: [{
    type: 'tuple', components: [
      { name: 'descriptorId', type: 'bytes32' }, { name: 'feedId', type: 'bytes32' }, { name: 'phase', type: 'uint8' },
      { name: 'price18', type: 'uint128' }, { name: 'observedAt', type: 'uint64' }, { name: 'inputAt', type: 'uint64' },
      { name: 'validFrom', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
      { name: 'reportHash', type: 'bytes32' },
    ],
  }],
}], functionName: 'readCurrent' });
console.log('adapter readCurrent price18:', stored.price18.toString(), 'observedAt:', stored.observedAt.toString());
console.log(JSON.stringify({ txHash: hash, blockNumber: receipt.blockNumber.toString(), price18: sample.price18.toString(), observedAt: sample.observedAt.toString(), reporter: signed.reporter }, null, 2));
