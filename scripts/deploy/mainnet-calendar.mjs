#!/usr/bin/env node
/**
 * Mainnet calendar root lifecycle: queue, wait, activate root, activate interval.
 *
 * This is not a copy of the testnet script with a different chain id. On mainnet the registry
 * enforces a 7-day publication notice and a 48-hour governance delay, and `activateRoot` is only
 * valid inside a half-open window. Missing that window burns the single-slot `(asset, year)` root
 * for that asset identity forever, so each step is a separate, resumable invocation that re-reads
 * chain state instead of assuming the previous run finished.
 *
 *   node scripts/deploy/mainnet-calendar.mjs plan
 *   node scripts/deploy/mainnet-calendar.mjs queue
 *   node scripts/deploy/mainnet-calendar.mjs activate-root
 *   node scripts/deploy/mainnet-calendar.mjs activate-interval
 *   node scripts/deploy/mainnet-calendar.mjs status
 *
 * Every write is simulated before it is broadcast, and nothing is published on a phase guess.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEventLogs, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hashCalendarLeaf, verifyMerkleProof } from '../../packages/protocol/src/calendar.mjs';
import { buildCalendarDataset } from '../calendar/calendar-builder.mjs';
import { buildEtMarketIntervals } from '../calendar/et-market-calendar.mjs';
import { planCalendarCoverageStart, planMainnetCalendarTimeline } from '../calendar/mainnet-timeline.mjs';

const MAINNET_CHAIN_ID = 4663;
const ZERO32 = `0x${'0'.repeat(64)}`;
const DAY = 86_400;
const STATE_PATH = 'evidence/deploy/mainnet-4663-calendar-state.json';

import CalendarArtifact from '../../contracts/out/CalendarRegistry.sol/CalendarRegistry.json' with { type: 'json' };

const CALENDAR_ABI = CalendarArtifact.abi;

const ROOT_STATUS = { 0: 'NONE', 1: 'QUEUED', 2: 'DONE', 3: 'CANCELLED' };

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function readState() {
  return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : null;
}

function writeState(next) {
  writeFileSync(STATE_PATH, `${JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
const deployerPk = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl) throw new Error('RH_MAINNET_RPC_PRIMARY is required');
if (!deployerPk) throw new Error('RH_MAINNET_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required');

if (!existsSync('evidence/deploy/mainnet-4663.json')) {
  throw new Error('mainnet deployment manifest is missing: evidence/deploy/mainnet-4663.json; run the mainnet deploy first');
}
const manifest = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
if (Number(manifest.chainId) !== MAINNET_CHAIN_ID) {
  throw new Error(`manifest chainId is ${manifest.chainId}, expected ${MAINNET_CHAIN_ID}`);
}
const assetQueue = existsSync('evidence/deploy/mainnet-4663-asset-queue.json')
  ? JSON.parse(readFileSync('evidence/deploy/mainnet-4663-asset-queue.json', 'utf8'))
  : null;
const assetId = assetQueue?.stock?.descriptorId ?? null;
const calendarRegistry = manifest.calendarRegistry;

const account = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Wrong chain ${chainId}; expected ${MAINNET_CHAIN_ID}`);

// Governance latency is a deployment parameter now. Read it from the controller instead of
// assuming the old 7-day notice / 48-hour delay, so this script follows whatever was deployed.
const SAFETY_ABI = parseAbi([
  'function governanceDelaySeconds() view returns (uint32)',
  'function calendarPublicationLeadSeconds() view returns (uint32)',
  'function operationExpirySeconds() view returns (uint32)',
]);
const [governanceDelaySeconds, calendarLeadSeconds, operationExpirySeconds] = await Promise.all([
  publicClient.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'governanceDelaySeconds' }),
  publicClient.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'calendarPublicationLeadSeconds' }),
  publicClient.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'operationExpirySeconds' }),
]);
const latency = {
  governanceDelaySeconds: Number(governanceDelaySeconds),
  calendarLeadSeconds: Number(calendarLeadSeconds),
  operationExpirySeconds: Number(operationExpirySeconds),
};

const head = await publicClient.getBlock();
const now = Number(head.timestamp);

async function simulateAndSend(request, label) {
  await publicClient.simulateContract({ ...request, account });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label} mined: ${hash} block ${receipt.blockNumber}`);
  return { hash, receipt };
}

async function currentIntervalState() {
  const [interval, nextInterval] = await Promise.all([
    publicClient.readContract({ address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [assetId] }),
    publicClient.readContract({ address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'nextInterval', args: [assetId] }),
  ]);
  // currentInterval() returns a zero leaf when the stored interval is outside its own window, so
  // "is there a live interval" is exactly "does it carry our assetId".
  const hasCurrent = interval?.assetId?.toLowerCase() === assetId.toLowerCase();
  return { interval, hasCurrent, nextInterval };
}

const command = process.argv[2] ?? 'status';

if (command === 'plan') {
  const coverageDays = Number(process.env.BELL_CALENDAR_DAYS || 60);
  // Leave only the configured notice or a short activation buffer. Do not round to midnight:
  // same-day activation is valid and avoids an unnecessary multi-hour idle period.
  const coverageStart = planCalendarCoverageStart({ now, noticeSeconds: latency.calendarLeadSeconds });
  const plan = planMainnetCalendarTimeline({
    now,
    coverageStart,
    coverageDays,
    noticeSeconds: latency.calendarLeadSeconds,
    etaDelaySeconds: latency.governanceDelaySeconds,
    expirySeconds: latency.operationExpirySeconds,
  });
  console.log(JSON.stringify({
    chainTime: now,
    chainTimeIso: new Date(now * 1000).toISOString(),
    assetId,
    assetAdmitted: Boolean(assetId),
    deployedLatency: latency,
    ...plan,
    queueAtIso: new Date(plan.queueAt * 1000).toISOString(),
    coverageStartIso: new Date(plan.coverageStart * 1000).toISOString(),
    coverageEndIso: new Date(plan.coverageEnd * 1000).toISOString(),
    activateRootEarliestIso: new Date(plan.activateRootEarliest * 1000).toISOString(),
    activateRootLatestIso: new Date(plan.activateRootLatest * 1000).toISOString(),
    operationExpiryIso: new Date(plan.operationExpiry * 1000).toISOString(),
  }, null, 2));
  if (!assetId) {
    console.log('\nNOTE: no admitted stock asset yet. The timeline above is valid, but `queue` needs');
    console.log('evidence/deploy/mainnet-4663-asset-queue.json from mainnet-admit-assets.mjs.');
  }
  if (!plan.ok) process.exit(1);
} else if (command === 'queue') {
  if (!assetId) {
    throw new Error('no admitted stock asset; run mainnet-admit-assets.mjs queue and activate first');
  }
  const existing = readState();
  if (existing?.rootOperationId) {
    console.log(`A root operation is already recorded: ${existing.rootOperationId}`);
    console.log('Refusing to queue a second root; the slot is single-use. Inspect status first.');
    process.exit(1);
  }

  const coverageDays = Number(process.env.BELL_CALENDAR_DAYS || 60);
  const coverageStart = planCalendarCoverageStart({ now, noticeSeconds: latency.calendarLeadSeconds });
  const coverageEnd = coverageStart + coverageDays * DAY;
  const plan = planMainnetCalendarTimeline({
    now,
    coverageStart,
    coverageDays,
    noticeSeconds: latency.calendarLeadSeconds,
    etaDelaySeconds: latency.governanceDelaySeconds,
    expirySeconds: latency.operationExpirySeconds,
  });
  if (!plan.ok) {
    console.error('Timeline is not viable:');
    for (const violation of plan.violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  const year = new Date(coverageStart * 1000).getUTCFullYear();

  const intervals = buildEtMarketIntervals(coverageStart, coverageEnd);
  const provenanceHash = keccak256(stringToHex('BELL_MAINNET_US_EASTERN_SESSIONS_V1'));
  const capabilityMask = Number(process.env.BELL_CAPABILITY_MASK || 0b110); // PRE + REGULAR
  const dataset = buildCalendarDataset({
    schemaVersion: 1,
    chainId: String(chainId),
    calendarRegistry,
    assetId,
    year,
    coverageStart: String(coverageStart),
    coverageEnd: String(coverageEnd),
    capabilityMask,
    datasetProvenance: {
      timezone: 'America/New_York',
      timezoneDatabaseVersion: '2026a',
      sourceRightsEvidenceHash: keccak256(stringToHex('BELL_SELF_DECLARED_SESSION_TABLE')),
      sources: [{ sourceId: 'bell-session-table', version: 'v1', hash: provenanceHash }],
    },
    intervals: intervals.map((interval) => ({
      start: String(interval.start),
      end: String(interval.end),
      phase: interval.phase,
      provenanceHash,
    })),
  });

  console.log(`Calendar: ${dataset.leafCount} leaves, ${new Date(coverageStart * 1000).toISOString()} .. ${new Date(coverageEnd * 1000).toISOString()}`);
  console.log(`Root: ${dataset.merkleRoot}`);

  const { hash, receipt } = await simulateAndSend({
    address: calendarRegistry,
    abi: CALENDAR_ABI,
    functionName: 'queueRoot',
    args: [assetId, {
      root: dataset.merkleRoot,
      leafCount: dataset.leafCount,
      coverageStart: BigInt(coverageStart),
      coverageEnd: BigInt(coverageEnd),
      queuedAt: 0n,
      executableAt: 0n,
      datasetHash: dataset.datasetHash,
    }],
  }, 'queueRoot');

  const events = parseEventLogs({ abi: CALENDAR_ABI, logs: receipt.logs, eventName: 'RootQueued' });
  const rootOperationId = events.find((e) => e.args.assetId.toLowerCase() === assetId.toLowerCase())?.args.operationId;
  if (!rootOperationId) throw new Error('RootQueued event missing from queueRoot receipt');

  writeState({
    chainId,
    assetId,
    calendarRegistry,
    rootOperationId,
    root: dataset.merkleRoot,
    datasetHash: dataset.datasetHash,
    leafCount: dataset.leafCount,
    year,
    coverageStart,
    coverageEnd,
    queuedAt: now,
    queuedTxHash: hash,
    queuedBlock: Number(receipt.blockNumber),
    eta: plan.rootEta,
    expiry: plan.operationExpiry,
    stage: 'QUEUED',
  });
  console.log(`Root queued. Activate at or after ${new Date(plan.rootEta * 1000).toISOString()}`);
  console.log(`Deadline: before ${new Date(plan.activateRootLatest * 1000).toISOString()}`);
} else if (command === 'activate-root') {
  const state = readState();
  if (!state?.rootOperationId) throw new Error('no queued root in state; run `queue` first');
  if (state.stage === 'ROOT_ACTIVE' || state.stage === 'INTERVAL_ACTIVE') {
    console.log(`Root already activated (stage ${state.stage}); nothing to do.`);
  } else {
    const op = await publicClient.readContract({
      address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'operation', args: [state.rootOperationId],
    }).catch(() => null);
    if (op) {
      const [kind, , eta, expiry, status] = op;
      console.log(`operation kind=${kind} eta=${eta} expiry=${expiry} status=${ROOT_STATUS[Number(status)] ?? status}`);
      if (Number(status) === 2) {
        console.log('Root is already DONE on chain.');
        writeState({ ...state, stage: 'ROOT_ACTIVE' });
        process.exit(0);
      }
      if (Number(status) !== 1) throw new Error(`root operation status is ${ROOT_STATUS[Number(status)] ?? status}, not QUEUED`);
      if (BigInt(now) < BigInt(eta)) {
        console.error(`Too early: the ETA is ${new Date(Number(eta) * 1000).toISOString()}, chain time is ${new Date(now * 1000).toISOString()}`);
        process.exit(1);
      }
      if (BigInt(now) >= BigInt(state.coverageStart)) {
        console.error('The activation window has closed: chain time is at or past coverageStart.');
        console.error('This root can no longer be activated. A new asset identity is required.');
        process.exit(1);
      }
      if (BigInt(now) > BigInt(expiry)) {
        console.error('The governance operation has expired. A new asset identity is required.');
        process.exit(1);
      }
    }
    await simulateAndSend({
      address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'activateRoot', args: [state.rootOperationId],
    }, 'activateRoot');
    writeState({ ...state, stage: 'ROOT_ACTIVE', rootActivatedAt: now });
  }
} else if (command === 'activate-interval') {
  const state = readState();
  if (!state?.rootOperationId) throw new Error('no queued root in state; run `queue` first');
  const { interval, hasCurrent } = await currentIntervalState();
  if (hasCurrent) {
    console.log(`Interval already active: phase ${interval.phase} until ${new Date(Number(interval.end) * 1000).toISOString()}`);
    writeState({ ...state, stage: 'INTERVAL_ACTIVE' });
    process.exit(0);
  }
  if (now < state.coverageStart) {
    console.error(`Too early: coverage starts ${new Date(state.coverageStart * 1000).toISOString()}, chain time is ${new Date(now * 1000).toISOString()}`);
    process.exit(1);
  }

  // Rebuild the same dataset the queue committed, so the proof matches the stored root.
  const intervals = buildEtMarketIntervals(state.coverageStart, state.coverageEnd);
  const provenanceHash = keccak256(stringToHex('BELL_MAINNET_US_EASTERN_SESSIONS_V1'));
  const dataset = buildCalendarDataset({
    schemaVersion: 1,
    chainId: String(chainId),
    calendarRegistry,
    assetId,
    year: state.year,
    coverageStart: String(state.coverageStart),
    coverageEnd: String(state.coverageEnd),
    capabilityMask: Number(process.env.BELL_CAPABILITY_MASK || 0b110),
    datasetProvenance: {
      timezone: 'America/New_York',
      timezoneDatabaseVersion: '2026a',
      sourceRightsEvidenceHash: keccak256(stringToHex('BELL_SELF_DECLARED_SESSION_TABLE')),
      sources: [{ sourceId: 'bell-session-table', version: 'v1', hash: provenanceHash }],
    },
    intervals: intervals.map((i) => ({ start: String(i.start), end: String(i.end), phase: i.phase, provenanceHash })),
  });
  if (dataset.merkleRoot !== state.root) {
    throw new Error(`rebuilt root ${dataset.merkleRoot} does not match the queued root ${state.root}`);
  }

  const activeIndex = dataset.leaves.findIndex((leaf) => Number(leaf.start) <= now && now < Number(leaf.end));
  if (activeIndex < 0) throw new Error('no calendar leaf covers the current chain time');
  const activeLeaf = dataset.leaves[activeIndex];
  if (!verifyMerkleProof(hashCalendarLeaf(activeLeaf), dataset.proofs[activeIndex], dataset.merkleRoot)) {
    throw new Error('active leaf proof does not verify against the root');
  }

  const toSol = (leaf) => ({
    assetId: leaf.assetId, year: leaf.year, index: leaf.index,
    start: BigInt(leaf.start), end: BigInt(leaf.end), phase: Number(leaf.phase), provenanceHash: leaf.provenanceHash,
  });
  const zeroLeaf = { assetId: ZERO32, year: 0, index: 0, start: 0n, end: 0n, phase: 0, provenanceHash: ZERO32 };
  const previousLeaf = activeIndex > 0 ? dataset.leaves[activeIndex - 1] : null;
  const nextLeaf = activeIndex + 1 < dataset.leafCount ? dataset.leaves[activeIndex + 1] : null;

  await simulateAndSend({
    address: calendarRegistry,
    abi: CALENDAR_ABI,
    functionName: 'activateInterval',
    args: [
      assetId,
      toSol(activeLeaf),
      previousLeaf ? toSol(previousLeaf) : zeroLeaf,
      nextLeaf ? toSol(nextLeaf) : zeroLeaf,
      [dataset.proofs[activeIndex], previousLeaf ? dataset.proofs[activeIndex - 1] : [], nextLeaf ? dataset.proofs[activeIndex + 1] : []],
    ],
  }, 'activateInterval');

  writeState({ ...state, stage: 'INTERVAL_ACTIVE', intervalActivatedAt: now, activePhase: Number(activeLeaf.phase) });
  console.log(`Interval active: phase ${activeLeaf.phase} until ${new Date(Number(activeLeaf.end) * 1000).toISOString()}`);
} else if (command === 'status') {
  const state = readState();
  const { interval, hasCurrent } = await currentIntervalState();
  console.log(JSON.stringify({
    chainId,
    chainTime: now,
    chainTimeIso: new Date(now * 1000).toISOString(),
    calendarRegistry,
    assetId,
    state,
    hasCurrentInterval: hasCurrent,
    currentInterval: hasCurrent
      ? {
        phase: Number(interval.phase),
        start: Number(interval.start),
        end: Number(interval.end),
        startIso: new Date(Number(interval.start) * 1000).toISOString(),
        endIso: new Date(Number(interval.end) * 1000).toISOString(),
      }
      : null,
  }, null, 2));
} else {
  console.error(`Unknown command "${command}". Use plan | queue | activate-root | activate-interval | status`);
  process.exit(1);
}
