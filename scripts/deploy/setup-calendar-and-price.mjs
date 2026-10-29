#!/usr/bin/env node
/**
 * Commit a long-lived US-Eastern market calendar for the current rehearsal asset, then publish
 * the report for whichever phase is active right now.
 *
 * Why a long calendar: the previous run committed a single 30-minute leaf, so the pool went dark
 * as soon as that window closed and no keeper could recover it. The registry is append-only, so a
 * short leaf can never be extended — it has to be replaced by a new root before it is used up.
 *
 * Every write is simulated first and read back afterwards. Nothing here relabels a Yahoo phase.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEventLogs, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hashCalendarLeaf, verifyMerkleProof } from '../../packages/protocol/src/calendar.mjs';
import { buildCalendarDataset } from '../calendar/calendar-builder.mjs';
import { buildEtMarketIntervals, etWallTimeToUnix } from '../calendar/et-market-calendar.mjs';
import { signYahooSourceSample } from '../../packages/protocol/src/yahoo-attestation.mjs';
import { fetchYahooChartQuote } from '../../packages/protocol/src/yahoo-quote.mjs';
import { yahooSessionPhase, yahooWireForCalendarPhase } from './keeper-price-config.mjs';

const ZERO32 = `0x${'0'.repeat(64)}`;
const DAY = 86_400;
const PHASE_CODE = { PRE: 1, REGULAR: 2, POST: 3, CLOSED: 5 };

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

const MANIFEST = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));
const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const deployerPk = env.DEPLOYER_PRIVATE_KEY;
const reporterPk = env.YAHOO_REPORTER_PRIVATE_KEY;
if (!rpcUrl || !deployerPk || !reporterPk) {
  throw new Error('RH_TESTNET_RPC_PRIMARY, DEPLOYER_PRIVATE_KEY, and YAHOO_REPORTER_PRIVATE_KEY required');
}

const stockAdapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const assetQueue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));
const stockAssetId = assetQueue.stock.descriptorId;
const { directAdapter, directWireHash } = stockAdapters;

const deployer = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: deployer, transport: http(rpcUrl) });
const chainId = await publicClient.getChainId();
if (chainId !== 46630) throw new Error(`Wrong chain ${chainId}`);

const calendarRegistry = MANIFEST.calendarRegistry;
const sessionRegistry = MANIFEST.sessionRegistry;
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || '0x20a066123c260bc6c5253f75e261c5056fde4bea';
const CALENDAR_ABI = CalendarArtifact.abi;
const SESSION_ABI = SessionArtifact.abi;

const coverageDays = Number(process.env.BELL_CALENDAR_DAYS || 60);

async function simulate(request, label) {
  await publicClient.simulateContract({ ...request, account: deployer });
  console.log(`${label} simulation passed`);
}

async function send(request, label) {
  await simulate(request, label);
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label} mined: ${hash} block ${receipt.blockNumber}`);
  return { hash, receipt };
}

const head = await publicClient.getBlock();
const now = Number(head.timestamp);
console.log(`Chain time ${now} (${new Date(now * 1000).toISOString()})`);

// Start at the beginning of the current Eastern day so every leaf is a complete session.
const todayStart = etWallTimeToUnix(
  new Date(now * 1000).getUTCFullYear(), new Date(now * 1000).getUTCMonth() + 1, new Date(now * 1000).getUTCDate(), 0, 0,
);
const easternToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date(now * 1000));
const get = (type) => Number(easternToday.find((part) => part.type === type)?.value);
const coverageStart = etWallTimeToUnix(get('year'), get('month'), get('day'), 0, 0);
// Coverage must start in the future for the registry's publication notice.
const start = Math.max(coverageStart, now + 120);
const end = start + coverageDays * DAY;
const year = new Date(start * 1000).getUTCFullYear();
if (new Date((end - 1) * 1000).getUTCFullYear() !== year) {
  throw new Error('calendar coverage must stay inside one UTC year; shorten BELL_CALENDAR_DAYS');
}

const intervals = buildEtMarketIntervals(start, end);
const provenanceHash = keccak256(stringToHex('BELL_REHEARSAL_US_EASTERN_SESSIONS_V2'));
const dataset = buildCalendarDataset({
  schemaVersion: 1,
  chainId: String(chainId),
  calendarRegistry,
  assetId: stockAssetId,
  year,
  coverageStart: String(start),
  coverageEnd: String(end),
  capabilityMask: 0b110, // PRE + REGULAR only, matching the admitted descriptor.
  datasetProvenance: {
    timezone: 'America/New_York',
    timezoneDatabaseVersion: '2026a',
    sourceRightsEvidenceHash: keccak256(stringToHex('BELL_REHEARSAL_SELF_DECLARED_SESSIONS')),
    sources: [{ sourceId: 'bell-rehearsal-session-table', version: 'v2', hash: provenanceHash }],
  },
  intervals: intervals.map((interval) => ({
    start: String(interval.start),
    end: String(interval.end),
    phase: interval.phase,
    provenanceHash,
  })),
});

console.log(`Calendar: ${dataset.leafCount} leaves, ${new Date(start * 1000).toISOString()} .. ${new Date(end * 1000).toISOString()}`);
console.log(`Root: ${dataset.merkleRoot}`);

// Pick the leaf that will be active when coverage opens, then wait for the chain to reach it.
const targetTime = Math.max(now, start);
const activeIndex = dataset.leaves.findIndex((leaf) => Number(leaf.start) <= targetTime && targetTime < Number(leaf.end));
if (activeIndex < 0) throw new Error('no calendar leaf covers the intended activation time');
const activeLeaf = dataset.leaves[activeIndex];
if (!verifyMerkleProof(hashCalendarLeaf(activeLeaf), dataset.proofs[activeIndex], dataset.merkleRoot)) {
  throw new Error('active leaf proof does not verify against the root');
}

const rootMetadata = {
  root: dataset.merkleRoot,
  leafCount: dataset.leafCount,
  coverageStart: BigInt(start),
  coverageEnd: BigInt(end),
  queuedAt: 0n,
  executableAt: 0n,
  datasetHash: dataset.datasetHash,
};

const queued = await send({
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'queueRoot',
  args: [stockAssetId, rootMetadata],
}, 'queueRoot');

const queuedEvents = parseEventLogs({ abi: CALENDAR_ABI, logs: queued.receipt.logs, eventName: 'RootQueued' });
const rootOpId = queuedEvents.find((event) => event.args.assetId.toLowerCase() === stockAssetId.toLowerCase())?.args.operationId;
if (!rootOpId) throw new Error('RootQueued event missing from queueRoot receipt');

await send({ address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'activateRoot', args: [rootOpId] }, 'activateRoot');

// activateInterval requires block.timestamp inside the leaf window.
for (;;) {
  const block = await publicClient.getBlock();
  if (Number(block.timestamp) >= Number(activeLeaf.start)) break;
  console.log(`waiting for chain time to reach ${Number(activeLeaf.start)} (now ${Number(block.timestamp)})`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

const toSol = (leaf) => ({
  assetId: leaf.assetId,
  year: leaf.year,
  index: leaf.index,
  start: BigInt(leaf.start),
  end: BigInt(leaf.end),
  phase: Number(leaf.phase),
  provenanceHash: leaf.provenanceHash,
});
const zeroLeaf = { assetId: ZERO32, year: 0, index: 0, start: 0n, end: 0n, phase: 0, provenanceHash: ZERO32 };
const previousLeaf = activeIndex > 0 ? dataset.leaves[activeIndex - 1] : null;
const nextLeaf = activeIndex + 1 < dataset.leafCount ? dataset.leaves[activeIndex + 1] : null;

await send({
  address: calendarRegistry,
  abi: CALENDAR_ABI,
  functionName: 'activateInterval',
  args: [
    stockAssetId,
    toSol(activeLeaf),
    previousLeaf ? toSol(previousLeaf) : zeroLeaf,
    nextLeaf ? toSol(nextLeaf) : zeroLeaf,
    [
      dataset.proofs[activeIndex],
      previousLeaf ? dataset.proofs[activeIndex - 1] : [],
      nextLeaf ? dataset.proofs[activeIndex + 1] : [],
    ],
  ],
}, 'activateInterval');

const interval = await publicClient.readContract({
  address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [stockAssetId],
});
if (interval.assetId.toLowerCase() !== stockAssetId.toLowerCase()) throw new Error('calendar readback has no active interval');
console.log(`Active interval: phase ${interval.phase}, ${new Date(Number(interval.start) * 1000).toISOString()} .. ${new Date(Number(interval.end) * 1000).toISOString()}`);

// Publish a report only when a phase-specific source actually exists and is fresh.
const calendarPhase = Number(interval.phase);
const stream = yahooWireForCalendarPhase(stockAdapters, calendarPhase);
if (!stream) {
  console.log(`Phase ${calendarPhase} has no admitted Yahoo wire; calendar committed, no report published.`);
  writeFileSync('evidence/deploy/testnet-calendar.json', `${JSON.stringify({
    assetId: stockAssetId, root: dataset.merkleRoot, operationId: rootOpId,
    coverageStart: start, coverageEnd: end, leafCount: dataset.leafCount,
    activePhase: calendarPhase, published: false, observedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  process.exit(0);
}

const expectedYahooPhase = calendarPhase === 1 ? 'PRE' : calendarPhase === 2 ? 'REGULAR' : calendarPhase === 3 ? 'POST' : null;
let quote = null;
try {
  quote = await fetchYahooChartQuote('AAPL');
} catch (error) {
  console.log(`Calendar committed; no live quote right now (${error.message}). Keeper will publish when the market opens.`);
}
if (!quote || quote.phase !== expectedYahooPhase) {
  console.log(`Calendar committed; Yahoo phase is ${quote?.phase ?? 'unavailable'}, calendar phase is ${expectedYahooPhase}. No report published.`);
  writeFileSync('evidence/deploy/testnet-calendar.json', `${JSON.stringify({
    assetId: stockAssetId, root: dataset.merkleRoot, operationId: rootOpId,
    coverageStart: start, coverageEnd: end, leafCount: dataset.leafCount,
    activePhase: calendarPhase, published: false, observedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  process.exit(0);
}

const blockNow = await publicClient.getBlock();
const currentTs = Number(blockNow.timestamp);
const observedAt = BigInt(quote.observedAt);
const price18 = BigInt(quote.priceRaw18);
const validUntil = observedAt + 119n < BigInt(currentTs + 119) ? observedAt + 119n : BigInt(currentTs + 119);
if (validUntil <= BigInt(currentTs)) throw new Error('fresh quote has no remaining validity');

const sampleDirect = {
  descriptorId: ZERO32, feedId: ZERO32, phase: 0, price18, observedAt,
  inputAt: BigInt(currentTs), validFrom: observedAt, expiresAt: BigInt(currentTs + 300), validUntil,
  reportHash: keccak256(stringToHex(`bell-direct-${currentTs}-${quote.observedAt}-${quote.priceRaw18}`)),
};
const signedDirect = await signYahooSourceSample(sampleDirect, {
  sourceConfigHash: directWireHash, chainId, verifier, privateKey: reporterPk,
});
await send({
  address: directAdapter, abi: YahooAdapterArtifact.abi, functionName: 'publishDirect',
  args: [sampleDirect, signedDirect.signature],
}, 'publishDirect');

const sampleStream = {
  descriptorId: ZERO32, feedId: stream.wire.feedId, phase: calendarPhase, price18, observedAt,
  inputAt: BigInt(currentTs), validFrom: observedAt, expiresAt: BigInt(currentTs + 300), validUntil,
  reportHash: keccak256(stringToHex(`bell-stream-${currentTs}-${quote.observedAt}-${quote.priceRaw18}`)),
};
const signedStream = await signYahooSourceSample(sampleStream, {
  sourceConfigHash: stream.wireHash, chainId, verifier, privateKey: reporterPk,
});
await send({
  address: sessionRegistry, abi: SESSION_ABI, functionName: 'submitReports',
  args: [stockAssetId, [signedStream.report]],
}, 'submitReports');

await send({ address: sessionRegistry, abi: SESSION_ABI, functionName: 'refreshHealth', args: [stockAssetId] }, 'refreshHealth');

const health = await publicClient.readContract({
  address: sessionRegistry, abi: SESSION_ABI, functionName: 'health', args: [stockAssetId],
});
console.log(`Health: ready=${health.ready} reasons=${health.reasonBits}`);

writeFileSync('evidence/deploy/testnet-calendar.json', `${JSON.stringify({
  assetId: stockAssetId, root: dataset.merkleRoot, operationId: rootOpId,
  coverageStart: start, coverageEnd: end, leafCount: dataset.leafCount,
  activePhase: calendarPhase, activeStart: Number(interval.start), activeEnd: Number(interval.end),
  published: true, quotePhase: quote.phase, quoteObservedAt: quote.observedAt,
  healthReady: health.ready, healthReasons: health.reasonBits.toString(),
  observedAt: new Date().toISOString(),
}, null, 2)}\n`);

console.log('>>> Calendar committed for the long horizon. <<<');
