#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEther, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';
import { hashCalendarLeaf } from '../../packages/protocol/src/calendar.mjs';
import { signYahooSourceSample } from '../../packages/protocol/src/yahoo-attestation.mjs';

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

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const deployerPk = env.DEPLOYER_PRIVATE_KEY;
const reporterPk = env.YAHOO_REPORTER_PRIVATE_KEY;

if (!rpcUrl || !deployerPk || !reporterPk) {
  throw new Error('RH_TESTNET_RPC_PRIMARY, DEPLOYER_PRIVATE_KEY, and YAHOO_REPORTER_PRIVATE_KEY required');
}

const stockAdapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const assetQueue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));

const { stockToken, directAdapter, regularAdapter, directWireHash, regularWireHash, regularWire } = stockAdapters;
const stockAssetId = assetQueue.stock.descriptorId;

const deployer = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const reporter = privateKeyToAccount(reporterPk.startsWith('0x') ? reporterPk : `0x${reporterPk}`);

const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: deployer, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== 46630) throw new Error(`Wrong chain ${chainId}`);

const calendarRegistry = TESTNET.contracts.calendarRegistry;
const sessionRegistry = TESTNET.contracts.sessionRegistry;
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || '0x20a066123c260bc6c5253f75e261c5056fde4bea';

console.log('Stock Asset ID:    ', stockAssetId);
console.log('Calendar Registry: ', calendarRegistry);
console.log('Session Registry:  ', sessionRegistry);
console.log('Reporter Address:  ', reporter.address);

const CALENDAR_ABI = CalendarArtifact.abi;
const SESSION_ABI = SessionArtifact.abi;

// 1. Setup Calendar Interval (covers now in PHASE_REGULAR = 2)
console.log('\n=== Step 1: Calendar Setup ===');
const head = await publicClient.getBlock();
const now = Number(head.timestamp);
console.log('Current chain timestamp:', now, new Date(now * 1000).toISOString());

// Start coverage in 30 seconds so `coverageStart >= notice` in queueRoot and `block.timestamp < coverageStart` in activateRoot!
const coverageStart = now + 30;
const coverageEnd = now + 86400 * 365; // 1 year coverage

const currentLeaf = {
  assetId: stockAssetId,
  year: 2026,
  index: 0,
  start: coverageStart,
  end: coverageEnd,
  phase: 2, // PHASE_REGULAR
  provenanceHash: keccak256(stringToHex('BELL_REHEARSAL_CALENDAR_2026')),
  calendarRegistry,
  chainId,
};

const leafHash = hashCalendarLeaf(currentLeaf);
console.log('Leaf hash / root:', leafHash);

const rootMetadata = {
  root: leafHash,
  leafCount: 1,
  coverageStart: BigInt(coverageStart),
  coverageEnd: BigInt(coverageEnd),
  queuedAt: 0n,
  executableAt: 0n,
  datasetHash: keccak256(stringToHex('BELL_CALENDAR_DATASET_2026')),
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

const currentLeafSol = {
  assetId: stockAssetId,
  year: 2026,
  index: 0,
  start: BigInt(coverageStart),
  end: BigInt(coverageEnd),
  phase: 2,
  provenanceHash: currentLeaf.provenanceHash,
};

console.log('Activating Interval on CalendarRegistry...');
const activateIntervalTx = await walletClient.writeContract({
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'activateInterval',
  args: [
    stockAssetId,
    currentLeafSol,
    zeroLeaf,
    zeroLeaf,
    [[], [], []],
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

// 2. Publish Direct Price & Submit Stream Report
console.log('\n=== Step 2: Publish Price Reports ===');
const blockNow = await publicClient.getBlock();
const currentTs = Number(blockNow.timestamp);
const price18 = parseEther('250.00'); // $250.00 AAPL reference price

// Sample parameters
const sampleDirect = {
  descriptorId: ZERO32,
  feedId: ZERO32,
  phase: 0,
  price18,
  observedAt: BigInt(currentTs - 2),
  inputAt: BigInt(currentTs - 2),
  validFrom: BigInt(currentTs - 2),
  expiresAt: BigInt(currentTs + 300),
  validUntil: BigInt(currentTs + 118),
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

// Stream Report (scope 1 REGULAR)
const sampleStream = {
  descriptorId: ZERO32,
  feedId: regularWire.feedId,
  phase: 2, // PHASE_REGULAR
  price18,
  observedAt: BigInt(currentTs - 2),
  inputAt: BigInt(currentTs - 2),
  validFrom: BigInt(currentTs - 2),
  expiresAt: BigInt(currentTs + 300),
  validUntil: BigInt(currentTs + 118),
  reportHash: keccak256(stringToHex(`aapl-stream-report-${currentTs}`)),
};

console.log('Signing stream report with reporter key...');
const signedStream = await signYahooSourceSample(sampleStream, {
  sourceConfigHash: regularWireHash,
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

if (!health.ready || health.reasonBits !== 0) {
  throw new Error(`Health not ready! reasonBits = ${health.reasonBits}`);
}

console.log('\n>>> SUCCESS! Stock Asset is HEALTHY and READY for pool creation! <<<');
