#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEther, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hashCalendarLeaf, hashSortedPair } from '../../packages/protocol/src/calendar.mjs';
import { signYahooSourceSample } from '../../packages/protocol/src/yahoo-attestation.mjs';
import { fetchYahooChartQuote } from '../../packages/protocol/src/yahoo-quote.mjs';

const ZERO32 = '0x' + '0'.repeat(64);
import CalendarArtifact from '../../contracts/out/CalendarRegistry.sol/CalendarRegistry.json' with { type: 'json' };
import SessionArtifact from '../../contracts/out/SessionRegistry.sol/SessionRegistry.json' with { type: 'json' };
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}


// Read the CURRENT deploy manifest so this script can never act on a superseded deployment.
const _manifestRaw = readFileSync(new URL('../../evidence/deploy/testnet-46630.json', import.meta.url), 'utf8');
const _manifest = JSON.parse(_manifestRaw);
const MANIFEST = Object.fromEntries(Object.entries(_manifest).map(([k, v]) => [k, String(v).toLowerCase()]));

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const deployerPk = env.DEPLOYER_PRIVATE_KEY;
const reporterPk = env.YAHOO_REPORTER_PRIVATE_KEY;

if (!rpcUrl || !deployerPk || !reporterPk) {
  throw new Error('RH_TESTNET_RPC_PRIMARY, DEPLOYER_PRIVATE_KEY, and YAHOO_REPORTER_PRIVATE_KEY required');
}

const stockAdapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const assetQueue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));

const { stockToken, directAdapter, regularAdapter, extendedAdapter, directWireHash, regularWireHash, regularWire, extendedWire, extendedWireHash } = stockAdapters;
const stockAssetId = assetQueue.stock.descriptorId;

const deployer = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const reporter = privateKeyToAccount(reporterPk.startsWith('0x') ? reporterPk : `0x${reporterPk}`);

const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: deployer, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== 46630) throw new Error(`Wrong chain ${chainId}`);

const calendarRegistry = MANIFEST.calendarRegistry;
const sessionRegistry = MANIFEST.sessionRegistry;
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || '0x20a066123c260bc6c5253f75e261c5056fde4bea';

console.log('Stock Asset ID:    ', stockAssetId);
console.log('Calendar Registry: ', calendarRegistry);
console.log('Session Registry:  ', sessionRegistry);
console.log('Reporter Address:  ', reporter.address);

const CALENDAR_ABI = CalendarArtifact.abi;
const SESSION_ABI = SessionArtifact.abi;

// 1. Commit a PRE-to-REGULAR calendar so the rehearsal can use real Yahoo premarket until open.
console.log('\n=== Step 1: Calendar Setup ===');
const head = await publicClient.getBlock();
const now = Number(head.timestamp);
console.log('Current chain timestamp:', now, new Date(now * 1000).toISOString());

const coverageStart = now + 30;
const regularStart = Math.floor(Date.parse(`${new Date(now * 1000).toISOString().slice(0, 10)}T13:30:00Z`) / 1000);
if (coverageStart >= regularStart) throw new Error('PRE rehearsal calendar requires current time before 13:30 UTC regular open');
const coverageEnd = Math.floor(Date.parse('2026-12-31T23:59:59Z') / 1000);
const provenanceHash = keccak256(stringToHex('BELL_REHEARSAL_CALENDAR_PRE_REGULAR_2026'));
const currentLeaf = { assetId: stockAssetId, year: 2026, index: 0, start: coverageStart, end: regularStart, phase: 1, provenanceHash, calendarRegistry, chainId };
const nextLeaf = { assetId: stockAssetId, year: 2026, index: 1, start: regularStart, end: coverageEnd, phase: 2, provenanceHash, calendarRegistry, chainId };
const currentHash = hashCalendarLeaf(currentLeaf);
const nextHash = hashCalendarLeaf(nextLeaf);
const root = hashSortedPair(currentHash, nextHash);
console.log('PRE leaf:', currentHash, 'REGULAR leaf:', nextHash, 'root:', root);

const rootMetadata = {
  root,
  leafCount: 2,
  coverageStart: BigInt(coverageStart),
  coverageEnd: BigInt(coverageEnd),
  queuedAt: 0n,
  executableAt: 0n,
  datasetHash: keccak256(stringToHex('BELL_CALENDAR_DATASET_PRE_REGULAR_2026')),
};

console.log('Queueing Calendar Root...');
const queueRootTx = await walletClient.writeContract({
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'queueRoot',
  args: [stockAssetId, rootMetadata],
});
const queueRootReceipt = await publicClient.waitForTransactionReceipt({ hash: queueRootTx });
const rootOpId = queueRootReceipt.logs[0].topics[1];
console.log('Root Queued. OpId:', rootOpId, 'block:', queueRootReceipt.blockNumber.toString());

console.log('Activating Calendar Root (zero delay on 46630)...');
const activateRootTx = await walletClient.writeContract({
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'activateRoot',
  args: [rootOpId],
});
await publicClient.waitForTransactionReceipt({ hash: activateRootTx });
console.log('Root Activated.');

// Wait until chain timestamp passes coverageStart (so interval can be activated)
console.log('Waiting for chain timestamp to reach coverageStart...');
while (true) {
  const b = await publicClient.getBlock();
  if (Number(b.timestamp) >= coverageStart) {
    console.log('Chain time reached:', Number(b.timestamp), '>=', coverageStart);
    break;
  }
  // Send a tiny empty transaction to advance testnet block timestamp if needed
  try {
    const bumpTx = await walletClient.sendTransaction({ to: deployer.address, value: 0n });
    await publicClient.waitForTransactionReceipt({ hash: bumpTx });
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));
}

// Activate Interval
const zeroLeaf = {
  assetId: ZERO32,
  year: 0,
  index: 0,
  start: 0n,
  end: 0n,
  phase: 0,
  provenanceHash: ZERO32,
};

const currentLeafSol = { ...currentLeaf, start: BigInt(currentLeaf.start), end: BigInt(currentLeaf.end) };
const nextLeafSol = { ...nextLeaf, start: BigInt(nextLeaf.start), end: BigInt(nextLeaf.end) };

console.log('Activating Interval on CalendarRegistry...');
const activateIntervalTx = await walletClient.writeContract({
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'activateInterval',
  args: [
    stockAssetId,
    currentLeafSol,
    zeroLeaf,
    nextLeafSol,
    [[nextHash], [], [currentHash]],
  ],
});
await publicClient.waitForTransactionReceipt({ hash: activateIntervalTx });
const activeInterval = await publicClient.readContract({
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'currentInterval',
  args: [stockAssetId],
});
console.log('Active Calendar Interval:', activeInterval);

// 2. Publish current Yahoo quote to the direct and extended-phase sources.
console.log('\n=== Step 2: Publish Yahoo Price Reports ===');
const quote = await fetchYahooChartQuote('AAPL');
const blockNow = await publicClient.getBlock();
const currentTs = Number(blockNow.timestamp);
const price18 = BigInt(quote.priceRaw18);
const observedAt = BigInt(quote.observedAt);
if (quote.phase !== 'PRE' || currentTs < coverageStart || currentTs >= regularStart) {
  throw new Error(`Expected a fresh PRE quote inside the PRE calendar interval; got ${quote.phase}`);
}
const validUntil = observedAt + 119n < BigInt(currentTs + 119) ? observedAt + 119n : BigInt(currentTs + 119);

const sampleDirect = {
  descriptorId: ZERO32,
  feedId: ZERO32,
  phase: 0,
  price18,
  observedAt,
  inputAt: BigInt(currentTs),
  validFrom: observedAt,
  expiresAt: BigInt(currentTs + 300),
  validUntil,
  reportHash: keccak256(stringToHex(`aapl-direct-quote-${currentTs}`)),
};

console.log('Signing direct quote with reporter key...');
const signedDirect = await signYahooSourceSample(sampleDirect, {
  sourceConfigHash: directWireHash,
  chainId,
  verifier,
  privateKey: reporterPk,
});

console.log('Publishing direct quote to Direct Adapter at', directAdapter, '...');
const publishDirectTx = await walletClient.writeContract({
  address: directAdapter,
  abi: YahooAdapterArtifact.abi,
  functionName: 'publishDirect',
  args: [sampleDirect, signedDirect.signature],
});
await publicClient.waitForTransactionReceipt({ hash: publishDirectTx });
console.log('Direct quote published onchain.');

// Stream report (scope 2 extended; PRE phase)
const sampleStream = {
  descriptorId: ZERO32,
  feedId: extendedWire.feedId,
  phase: 1, // PHASE_PRE
  price18,
  observedAt,
  inputAt: BigInt(currentTs),
  validFrom: observedAt,
  expiresAt: BigInt(currentTs + 300),
  validUntil,
  reportHash: keccak256(stringToHex(`aapl-stream-report-${currentTs}`)),
};

console.log('Signing stream report with reporter key...');
const signedStream = await signYahooSourceSample(sampleStream, {
  sourceConfigHash: extendedWireHash,
  chainId,
  verifier,
  privateKey: reporterPk,
});

console.log('Submitting report to SessionRegistry at', sessionRegistry, '...');
const submitTx = await walletClient.writeContract({
  address: sessionRegistry,
  abi: SESSION_ABI,
  functionName: 'submitReports',
  args: [stockAssetId, [signedStream.report]],
});
await publicClient.waitForTransactionReceipt({ hash: submitTx });
console.log('Report submitted successfully.');

// 3. Refresh Health on SessionRegistry
console.log('\n=== Step 3: Refresh Health on SessionRegistry ===');
const refreshTx = await walletClient.writeContract({
  address: sessionRegistry,
  abi: SESSION_ABI,
  functionName: 'refreshHealth',
  args: [stockAssetId],
});
await publicClient.waitForTransactionReceipt({ hash: refreshTx });
const health = await publicClient.readContract({
  address: sessionRegistry,
  abi: SESSION_ABI,
  functionName: 'health',
  args: [stockAssetId],
});

console.log('SessionRegistry Health for Stock Asset:', {
  ready: health.ready,
  reasonBits: health.reasonBits.toString(),
  healthySince: health.healthySince.toString(),
  validUntil: health.validUntil.toString(),
  latestObservation: health.latestObservation.toString(),
});

if (!health.ready) {
  throw new Error(`Health not ready! reasonBits = ${health.reasonBits}`);
}
console.log("Health is ready with reasonBits 0.");

console.log('\n>>> SUCCESS! Stock Asset is HEALTHY and READY for pool creation! <<<');
