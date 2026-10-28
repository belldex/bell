#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEventLogs, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hashCalendarLeaf } from '../../packages/protocol/src/calendar.mjs';
import { signYahooSourceSample } from '../../packages/protocol/src/yahoo-attestation.mjs';
import { fetchYahooChartQuote } from '../../packages/protocol/src/yahoo-quote.mjs';
import { activeSessionCalendar, yahooWireForCalendarPhase } from './keeper-price-config.mjs';

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

async function waitForChainTime(target, label) {
  for (;;) {
    const block = await publicClient.getBlock();
    const timestamp = Number(block.timestamp);
    if (timestamp >= target) {
      console.log(`${label}: chain time ${timestamp} >= ${target}`);
      return block;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

console.log('Stock Asset ID:    ', stockAssetId);
console.log('Calendar Registry: ', calendarRegistry);
console.log('Session Registry:  ', sessionRegistry);
console.log('Reporter Address:  ', reporter.address);

const CALENDAR_ABI = CalendarArtifact.abi;
const SESSION_ABI = SessionArtifact.abi;

// 1. Commit a single active-session leaf for this fresh rehearsal identity.
console.log('\n=== Step 1: Calendar Setup ===');
const head = await publicClient.getBlock();
const now = Number(head.timestamp);
console.log('Current chain timestamp:', now, new Date(now * 1000).toISOString());
const quote = await fetchYahooChartQuote('AAPL');
const activeCalendar = activeSessionCalendar(quote, now);
if (!activeCalendar) throw new Error(`Yahoo quote is stale, unsupported, or not a current session: ${quote.phase}/${quote.ageSeconds}s`);
const stream = yahooWireForCalendarPhase(stockAdapters, activeCalendar.phase);
if (!stream) throw new Error(`No admitted Yahoo wire for current calendar phase ${activeCalendar.phase}`);
const coverageStart = activeCalendar.start;
const coverageEnd = activeCalendar.end;
const year = new Date(coverageStart * 1000).getUTCFullYear();
if (new Date((coverageEnd - 1) * 1000).getUTCFullYear() !== year) throw new Error('Active rehearsal interval crosses a UTC year boundary');
const provenanceHash = keccak256(stringToHex(`BELL_REHEARSAL_ACTIVE_SESSION_${quote.phase}_2026`));
const currentLeaf = { assetId: stockAssetId, year, index: 0, start: coverageStart, end: coverageEnd, phase: activeCalendar.phase, provenanceHash, calendarRegistry, chainId };
const currentHash = hashCalendarLeaf(currentLeaf);
const root = currentHash;
console.log(`${quote.phase} leaf:`, currentHash, 'root:', root);

const rootMetadata = {
  root,
  leafCount: 1,
  coverageStart: BigInt(coverageStart),
  coverageEnd: BigInt(coverageEnd),
  queuedAt: 0n,
  executableAt: 0n,
  datasetHash: keccak256(stringToHex(`BELL_CALENDAR_DATASET_ACTIVE_SESSION_${quote.phase}_2026`)),
};

const queueRootRequest = {
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'queueRoot',
  args: [stockAssetId, rootMetadata],
};
await publicClient.simulateContract({ ...queueRootRequest, account: deployer });
console.log('queueRoot simulation passed; broadcasting.');
const queueRootTx = await walletClient.writeContract(queueRootRequest);
const queueRootReceipt = await publicClient.waitForTransactionReceipt({ hash: queueRootTx });
if (queueRootReceipt.status !== 'success') throw new Error(`queueRoot reverted: ${queueRootTx}`);
const queuedEvents = parseEventLogs({ abi: CALENDAR_ABI, logs: queueRootReceipt.logs, eventName: 'RootQueued' });
const rootOpId = queuedEvents.find((event) => event.args.assetId.toLowerCase() === stockAssetId.toLowerCase())?.args.operationId;
if (!rootOpId) throw new Error(`Could not find RootQueued event for new asset in ${queueRootTx}`);
console.log('Root Queued. OpId:', rootOpId, 'block:', queueRootReceipt.blockNumber.toString());

await waitForChainTime(coverageStart - 5, 'Waiting to activate root before its coverage starts');
const activateRootRequest = {
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'activateRoot',
  args: [rootOpId],
};
await publicClient.simulateContract({ ...activateRootRequest, account: deployer });
console.log('activateRoot simulation passed; broadcasting.');
const activateRootTx = await walletClient.writeContract(activateRootRequest);
const activateRootReceipt = await publicClient.waitForTransactionReceipt({ hash: activateRootTx });
if (activateRootReceipt.status !== 'success') throw new Error(`activateRoot reverted: ${activateRootTx}`);
console.log('Root Activated.');
await waitForChainTime(coverageStart, 'Waiting for calendar interval start');

const freshQuote = await fetchYahooChartQuote('AAPL');
const afterRootBlock = await publicClient.getBlock();
const intervalNow = Number(afterRootBlock.timestamp);
if (freshQuote.phase !== quote.phase || freshQuote.ageSeconds >= 45 || intervalNow >= coverageEnd) {
  throw new Error(`Yahoo phase changed/staled or active session interval expired: ${freshQuote.phase}/${freshQuote.ageSeconds}s`);
}

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

console.log('Activating Interval on CalendarRegistry...');
const activateIntervalRequest = {
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'activateInterval',
  args: [stockAssetId, currentLeafSol, zeroLeaf, zeroLeaf, [[], [], []]],
};
await publicClient.simulateContract({ ...activateIntervalRequest, account: deployer });
console.log('activateInterval simulation passed; broadcasting.');
const activateIntervalTx = await walletClient.writeContract(activateIntervalRequest);
const activateIntervalReceipt = await publicClient.waitForTransactionReceipt({ hash: activateIntervalTx });
if (activateIntervalReceipt.status !== 'success') throw new Error(`activateInterval reverted: ${activateIntervalTx}`);
const activeInterval = await publicClient.readContract({
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'currentInterval',
  args: [stockAssetId],
});
const intervalBlock = await publicClient.getBlock();
const activatedAt = await publicClient.getBlock();
if (activeInterval.assetId.toLowerCase() !== stockAssetId.toLowerCase()
  || Number(activeInterval.phase) !== activeCalendar.phase
  || Number(activeInterval.start) > Number(activatedAt.timestamp)
  || Number(activeInterval.end) <= Number(activatedAt.timestamp)) {
  throw new Error(`Calendar readback does not match the active ${quote.phase} rehearsal leaf`);
}
console.log('Active Calendar Interval:', activeInterval);

// 2. Publish a fresh Yahoo quote to the direct and phase-matched stream sources.
console.log('\n=== Step 2: Publish Yahoo Price Reports ===');
const blockNow = await publicClient.getBlock();
const currentTs = Number(blockNow.timestamp);
const reportQuote = await fetchYahooChartQuote('AAPL');
if (reportQuote.phase !== quote.phase || reportQuote.ageSeconds >= 45 || reportQuote.observedAt < freshQuote.observedAt) {
  throw new Error(`Yahoo phase changed or quote is not a fresh observation: ${reportQuote.phase}/${reportQuote.ageSeconds}s`);
}
const price18 = BigInt(reportQuote.priceRaw18);
const observedAt = BigInt(reportQuote.observedAt);
if (currentTs < coverageStart || currentTs >= coverageEnd) {
  throw new Error(`Chain time ${currentTs} is outside active ${quote.phase} calendar interval`);
}
const validUntil = observedAt + 119n < BigInt(currentTs + 119) ? observedAt + 119n : BigInt(currentTs + 119);
if (validUntil <= BigInt(currentTs)) throw new Error('Fresh Yahoo quote has no remaining report validity');

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
  reportHash: keccak256(stringToHex(`aapl-direct-quote-${currentTs}-${reportQuote.observedAt}`)),
};

console.log('Signing direct quote with reporter key...');
const signedDirect = await signYahooSourceSample(sampleDirect, {
  sourceConfigHash: directWireHash,
  chainId,
  verifier,
  privateKey: reporterPk,
});

console.log('Publishing direct quote to Direct Adapter at', directAdapter, '...');
const publishDirectRequest = {
  address: directAdapter,
  abi: YahooAdapterArtifact.abi,
  functionName: 'publishDirect',
  args: [sampleDirect, signedDirect.signature],
};
await publicClient.simulateContract({ ...publishDirectRequest, account: deployer });
console.log('publishDirect simulation passed; broadcasting.');
const publishDirectTx = await walletClient.writeContract(publishDirectRequest);
const directReceipt = await publicClient.waitForTransactionReceipt({ hash: publishDirectTx });
if (directReceipt.status !== 'success') throw new Error(`publishDirect reverted: ${publishDirectTx}`);
console.log('Direct quote published onchain.');

// Stream report uses the admitted wire corresponding to the active calendar phase.
const sampleStream = {
  descriptorId: ZERO32,
  feedId: stream.wire.feedId,
  phase: activeCalendar.phase,
  price18,
  observedAt,
  inputAt: BigInt(currentTs),
  validFrom: observedAt,
  expiresAt: BigInt(currentTs + 300),
  validUntil,
  reportHash: keccak256(stringToHex(`aapl-stream-report-${currentTs}-${reportQuote.observedAt}`)),
};

console.log('Signing stream report with reporter key...');
const signedStream = await signYahooSourceSample(sampleStream, {
  sourceConfigHash: stream.wireHash,
  chainId,
  verifier,
  privateKey: reporterPk,
});

console.log('Submitting report to SessionRegistry at', sessionRegistry, '...');
const submitRequest = {
  address: sessionRegistry,
  abi: SESSION_ABI,
  functionName: 'submitReports',
  args: [stockAssetId, [signedStream.report]],
};
await publicClient.simulateContract({ ...submitRequest, account: deployer });
console.log('submitReports simulation passed; broadcasting.');
const submitTx = await walletClient.writeContract(submitRequest);
const submitReceipt = await publicClient.waitForTransactionReceipt({ hash: submitTx });
if (submitReceipt.status !== 'success') throw new Error(`submitReports reverted: ${submitTx}`);
console.log('Report submitted successfully.');

// 3. Refresh Health on SessionRegistry
console.log('\n=== Step 3: Refresh Health on SessionRegistry ===');
const refreshRequest = {
  address: sessionRegistry,
  abi: SESSION_ABI,
  functionName: 'refreshHealth',
  args: [stockAssetId],
};
await publicClient.simulateContract({ ...refreshRequest, account: deployer });
console.log('refreshHealth simulation passed; broadcasting.');
const refreshTx = await walletClient.writeContract(refreshRequest);
const refreshReceipt = await publicClient.waitForTransactionReceipt({ hash: refreshTx });
if (refreshReceipt.status !== 'success') throw new Error(`refreshHealth reverted: ${refreshTx}`);
const health = await publicClient.readContract({
  address: sessionRegistry,
  abi: SESSION_ABI,
  functionName: 'health',
  args: [stockAssetId],
});
const postRefreshBlock = await publicClient.getBlock();

console.log('SessionRegistry Health for Stock Asset:', {
  ready: health.ready,
  reasonBits: health.reasonBits.toString(),
  healthySince: health.healthySince.toString(),
  validUntil: health.validUntil.toString(),
  latestObservation: health.latestObservation.toString(),
});

if (!health.ready || health.reasonBits !== 0n || health.validUntil <= postRefreshBlock.timestamp) {
  throw new Error(`Health not ready! reasonBits = ${health.reasonBits}`);
}
const sampleReadback = await publicClient.readContract({ address: sessionRegistry, abi: SESSION_ABI, functionName: 'latestSample', args: [stockAssetId, activeCalendar.phase] });
if (Number(sampleReadback.phase) !== activeCalendar.phase || sampleReadback.price18 !== price18 || sampleReadback.reportHash !== sampleStream.reportHash) {
  throw new Error(`SessionRegistry report readback does not match the active phase-${activeCalendar.phase} Yahoo report`);
}
console.log(`Health is ready with reasonBits 0 for ${quote.phase}; direct=${publishDirectTx}, stream=${submitTx}, refresh=${refreshTx}.`);

console.log('\n>>> SUCCESS! Stock Asset is HEALTHY and READY for pool creation! <<<');
