#!/usr/bin/env node
/**
 * Mainnet calendar root lifecycle: queue, wait, activate root, activate interval.
 *
 * This is not a copy of the testnet script with a different chain id. On mainnet the registry
 * reads the configured governance delay and publication lead from the deployed controller, and
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
import { spawnSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEventLogs, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fileURLToPath } from 'node:url';
import { hashCalendarLeaf, verifyMerkleProof } from '../../packages/protocol/src/calendar.mjs';
import { buildCalendarDataset } from '../calendar/calendar-builder.mjs';
import { buildEtMarketIntervals } from '../calendar/et-market-calendar.mjs';
import { coverageEndWithinUtcYear, planCalendarCoverageStart, planMainnetCalendarTimeline } from '../calendar/mainnet-timeline.mjs';
import { loadEnvFile } from './env-loader.mjs';
import { buildCalendarRootGovernanceCall } from './mainnet-calendar-hybrid-lib.mjs';

const MAINNET_CHAIN_ID = 46630; // Robinhood testnet; name kept so the rest of the script reads the same
const ZERO32 = `0x${'0'.repeat(64)}`;
const DAY = 86_400;
const STATE_PATH = 'evidence/deploy/testnet-46630-calendar-state.json';

import CalendarArtifact from '../../contracts/out/CalendarRegistry.sol/CalendarRegistry.json' with { type: 'json' };

const CALENDAR_ABI = CalendarArtifact.abi;

const ROOT_STATUS = { 0: 'NONE', 1: 'QUEUED', 2: 'DONE', 3: 'CANCELLED' };

function readState() {
  if (!existsSync(STATE_PATH_ASSET)) return null;
  const state = JSON.parse(readFileSync(STATE_PATH_ASSET, 'utf8'));
  // Calendar state is bound to the immutable registry and asset. Never reuse an old deployment's
  // single-use root operation when the manifest now points at a newly deployed registry.
  if (state.calendarRegistry?.toLowerCase() !== calendarRegistry.toLowerCase()
    || state.assetId?.toLowerCase() !== assetId?.toLowerCase()) return null;
  return state;
}

function writeState(next) {
  writeFileSync(STATE_PATH_ASSET, `${JSON.stringify({ ...next, assetId, assetLabel, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

const env = loadEnvFile();
for (const name of ['BELL_MAINNET_GAS_RESERVE_WEI', 'BELL_CALENDAR_DAYS', 'BELL_CAPABILITY_MASK']) {
  if (process.env[name] !== undefined) env[name] = process.env[name];
}
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const deployerPk = env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl) throw new Error('RH_TESTNET_RPC_PRIMARY is required');
if (!deployerPk) throw new Error('RH_MAINNET_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required');

const deploymentManifestPath = 'evidence/deploy/pq-hooks-testnet-46630.json';
if (!existsSync(deploymentManifestPath)) {
  throw new Error(`deployment manifest is missing: ${deploymentManifestPath}; run and verify the Mainnet deployment first`);
}
const deploymentManifest = JSON.parse(readFileSync(deploymentManifestPath, 'utf8'));
const manifest = { ...deploymentManifest, ...(deploymentManifest.contracts ?? {}) };
const broadcastRequested = process.argv.includes('--broadcast');
const authorizeSpend = process.argv.includes('--i-authorize-spend');
if (broadcastRequested && deploymentManifest.status !== 'BROADCASTED_AND_LIVE_CODE_VERIFIED') throw new Error('manifest is not verified live');
if (Number(manifest.chainId) !== MAINNET_CHAIN_ID) {
  throw new Error(`manifest chainId is ${manifest.chainId}, expected ${MAINNET_CHAIN_ID}`);
}
const testnetAdapters = JSON.parse(readFileSync('evidence/deploy/testnet-46630-chainlink-session-adapters.json', 'utf8'));
const assetQueue = { chainId: 46630, stocks: { NVDA: { symbol: 'NVDA', token: testnetAdapters.assets.NVDA.stockToken, descriptorId: deploymentManifest.assetDescriptors.NVDA.descriptorId, isStock: true, capabilityMask: 30 } } };
const ANT_STATE = process.env.ANT_STATE || 'evidence/deploy/testnet-46630-ant.json'; // ANT_STATE=evidence/deploy/testnet-46630-ant-delegated.json selects the delegated-source rehearsal
if (existsSync(ANT_STATE)) { const ant = JSON.parse(readFileSync(ANT_STATE, 'utf8')); if (ant.admittedDescriptorId) assetQueue.stocks.ANT = { symbol: 'ANT', token: ant.token, descriptorId: ant.admittedDescriptorId, isStock: true, capabilityMask: 30 }; }
// Multi-asset: resolve the target asset via --asset=<descriptorId|SYMBOL> falling back to the
// first stock in the queue evidence. Each asset owns its own calendar root/state file.
const ASSET_ARG = process.argv.find((a) => a.startsWith('--asset='))?.slice('--asset='.length) ?? null;
const stockEntries = Object.entries(assetQueue?.stocks ?? {});
const resolvedStock = ASSET_ARG
  ? stockEntries.find(([symbol, s]) => symbol === ASSET_ARG || s.descriptorId?.toLowerCase() === ASSET_ARG.toLowerCase())
    ?? (ASSET_ARG.match(/^0x[0-9a-fA-F]{64}$/) ? [null, { descriptorId: ASSET_ARG, symbol: ASSET_ARG.slice(0, 10) }] : null)
  : stockEntries[0] ?? null;
const assetId = resolvedStock?.[1]?.descriptorId ?? null;
const assetLabel = resolvedStock?.[0] ?? 'asset';
// The PQ stack keeps its own state files (BELL_CALENDAR_STATE_PREFIX=evidence/deploy/pq-hooks-mainnet-calendar-state) so a run
// against it can never overwrite the production calendar state that the production keeper config reads.
const STATE_PATH_ASSET = `${env.BELL_CALENDAR_STATE_PREFIX || 'evidence/deploy/testnet-46630-calendar-state'}-${assetLabel}.json`;
const calendarRegistry = manifest.calendarRegistry;

const account = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
if (broadcastRequested && !authorizeSpend) throw new Error('calendar writes require --broadcast --i-authorize-spend');

const chainId = await publicClient.getChainId();
if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Wrong chain ${chainId}; expected ${MAINNET_CHAIN_ID}`);

// Governance latency is a deployment parameter now. Read it from the controller instead of
// assuming the old 7-day notice / 48-hour delay, so this script follows whatever was deployed.
const SAFETY_ABI = parseAbi([
  'function governanceDelaySeconds() view returns (uint32)',
  'function calendarPublicationLeadSeconds() view returns (uint32)',
  'function operationExpirySeconds() view returns (uint32)',
  'function hybridAuth() view returns (address)',
]);
const SAFETY_HYBRID_ABI = parseAbi([
  'function queueGovernanceCall(address target,bytes callData,uint256 deadline,bytes ecdsaSignature,bytes pqSignature) returns (bytes32 operationId)',
  'function executeGovernanceCall(bytes32 operationId) returns (bytes returnData)',
  'function operation(bytes32 operationId) view returns (uint8 kind,bytes32 payloadHash,uint64 eta,uint64 expiry,uint8 status)',
  'event GovernanceCallQueued(bytes32 indexed operationId,address indexed target,bytes32 payloadHash,uint64 eta)',
]);
const HYBRID_AUTH_ABI = parseAbi([
  'function registry() view returns (address)',
  'function nonce(bytes32 role) view returns (uint256)',
  'function actionDigest(bytes32 role,address target,bytes32 action,bytes32 payloadHash,uint256 actionNonce,uint32 keyVersion,uint256 deadline) view returns (bytes32)',
]);
const PQ_REGISTRY_ABI = parseAbi([
  'function roleKey(bytes32 role) view returns ((address ecdsaSigner,bytes32 publicKeyCommitment,uint32 maxStatefulSignatures,uint32 nextStatefulLeaf,uint32 keyVersion,bool installed))',
]);
const [governanceDelaySeconds, calendarLeadSeconds, operationExpirySeconds] = await Promise.all([
  publicClient.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'governanceDelaySeconds' }),
  publicClient.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'calendarPublicationLeadSeconds' }),
  publicClient.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'operationExpirySeconds' }),
]);
const hybridAuthAddress = await publicClient.readContract({
  address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'hybridAuth',
}).catch(() => null);
const hybridGovernance = Boolean(hybridAuthAddress && !/^0x0{40}$/i.test(hybridAuthAddress));
const latency = {
  governanceDelaySeconds: Number(governanceDelaySeconds),
  calendarLeadSeconds: Number(calendarLeadSeconds),
  operationExpirySeconds: Number(operationExpirySeconds),
};

const head = await publicClient.getBlock();
const now = Number(head.timestamp);

async function simulateAndSend(request, label) {
  await publicClient.simulateContract({ ...request, account });
  if (!broadcastRequested || !authorizeSpend) throw new Error(`${label} simulated only; add --broadcast --i-authorize-spend to submit`);
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label} mined: ${hash} block ${receipt.blockNumber}`);
  return { hash, receipt };
}

function localPqSignature(command, digest, expectedLeaf) {
  const signerPath = fileURLToPath(new URL('../../contracts/pq/signer/signer.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [signerPath, command, 'governance', digest], {
    encoding: 'utf8',
    env: { ...process.env, BELL_PQ_KEY_PROFILE: 'robinhood-46630' },
  });
  if (child.status !== 0) throw new Error(`local Mainnet governance PQ ${command} failed: ${child.stderr.trim()}`);
  const result = JSON.parse(child.stdout);
  if (Number(result.leafIndex) !== Number(expectedLeaf)) {
    throw new Error(`local governance signer is at leaf ${result.leafIndex}, onchain role expects ${expectedLeaf}`);
  }
  return result.signature;
}

async function queueHybridGovernanceCall(call) {
  const auth = hybridAuthAddress;
  const keyRegistry = await publicClient.readContract({ address: auth, abi: HYBRID_AUTH_ABI, functionName: 'registry' });
  const [nonce, roleKey] = await Promise.all([
    publicClient.readContract({ address: auth, abi: HYBRID_AUTH_ABI, functionName: 'nonce', args: [call.role] }),
    publicClient.readContract({ address: keyRegistry, abi: PQ_REGISTRY_ABI, functionName: 'roleKey', args: [call.role] }),
  ]);
  if (roleKey.ecdsaSigner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`deployer wallet ${account.address} does not match the Mainnet governance signer`);
  }
  const deadline = BigInt(now + 3600);
  const digest = await publicClient.readContract({
    address: auth, abi: HYBRID_AUTH_ABI, functionName: 'actionDigest',
    args: [call.role, manifest.safetyController, call.action, call.payloadHash, nonce, roleKey.keyVersion, deadline],
  });
  const ecdsaSignature = await account.sign({ hash: digest });
  const previewSignature = localPqSignature('preview', digest, roleKey.nextStatefulLeaf);
  const request = {
    address: manifest.safetyController,
    abi: SAFETY_HYBRID_ABI,
    functionName: 'queueGovernanceCall',
    args: [call.target, call.callData, deadline, ecdsaSignature, previewSignature],
    account,
  };
  await publicClient.simulateContract(request);
  console.log(`Hybrid governance queue simulation passed (nonce ${nonce}, PQ leaf ${roleKey.nextStatefulLeaf}).`);
  if (!broadcastRequested || !authorizeSpend) return { status: 'SIMULATED', digest, deadline };

  const pqSignature = localPqSignature('sign', digest, roleKey.nextStatefulLeaf);
  const broadcastRequest = { ...request, args: [call.target, call.callData, deadline, ecdsaSignature, pqSignature] };
  await publicClient.simulateContract(broadcastRequest);
  const hash = await walletClient.writeContract(broadcastRequest);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`queueGovernanceCall reverted: ${hash}`);
  const event = parseEventLogs({ abi: SAFETY_HYBRID_ABI, logs: receipt.logs, eventName: 'GovernanceCallQueued' })
    .find((entry) => entry.args.target.toLowerCase() === call.target.toLowerCase());
  if (!event) throw new Error('GovernanceCallQueued event missing from receipt');
  console.log(`Hybrid governance call queued: ${event.args.operationId} ETA ${new Date(Number(event.args.eta) * 1000).toISOString()}`);
  return { status: 'QUEUED', hash, receipt, operationId: event.args.operationId, eta: Number(event.args.eta), digest };
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

function activeRootCoverageEnd(state) {
  return state && ['ROOT_ACTIVE', 'INTERVAL_ACTIVE'].includes(state.stage)
    ? Number(state.coverageEnd || 0)
    : 0;
}

const command = process.argv[2] ?? 'status';

if (command === 'plan') {
  const previous = readState();
  // Leave only the configured notice or a short activation buffer. Do not round to midnight:
  // same-day activation is valid and avoids an unnecessary multi-hour idle period.
  const effectiveNotice = latency.calendarLeadSeconds + (hybridGovernance ? latency.governanceDelaySeconds : 0);
  const coverageStart = Math.max(
    planCalendarCoverageStart({ now, noticeSeconds: effectiveNotice }),
    activeRootCoverageEnd(previous),
  );
  const coverageDays = Number(env.BELL_CALENDAR_DAYS || 60);
  const coverageEnd = coverageEndWithinUtcYear({ coverageStart, requestedDays: coverageDays });
  const plan = planMainnetCalendarTimeline({
    now,
    coverageStart,
    coverageDays,
    coverageEnd,
    noticeSeconds: latency.calendarLeadSeconds,
    etaDelaySeconds: latency.governanceDelaySeconds * (hybridGovernance ? 2 : 1),
    expirySeconds: latency.operationExpirySeconds,
  });
  console.log(JSON.stringify({
    chainTime: now,
    chainTimeIso: new Date(now * 1000).toISOString(),
    assetId,
    assetAdmitted: Boolean(assetId),
    deployedLatency: latency,
    previousRootCoverageEnd: activeRootCoverageEnd(previous) || null,
    requestedCoverageDays: Number(env.BELL_CALENDAR_DAYS || 60),
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
  if (existing?.stage === 'GOVERNANCE_QUEUED' || existing?.stage === 'QUEUED'
    || (existing?.rootOperationId && !['ROOT_ACTIVE', 'INTERVAL_ACTIVE'].includes(existing.stage))) {
    console.log(`A root operation is already recorded: ${existing.rootOperationId}`);
    console.log('A root operation is still pending. Finish or inspect its lifecycle before queueing another.');
    process.exit(1);
  }

  const previousCoverageEnd = activeRootCoverageEnd(existing);
  const effectiveNotice = latency.calendarLeadSeconds + (hybridGovernance ? latency.governanceDelaySeconds : 0);
  const coverageStart = Math.max(
    planCalendarCoverageStart({ now, noticeSeconds: effectiveNotice }),
    previousCoverageEnd,
  );
  const coverageDays = Number(env.BELL_CALENDAR_DAYS || 60);
  const coverageEnd = coverageEndWithinUtcYear({ coverageStart, requestedDays: coverageDays });
  const plan = planMainnetCalendarTimeline({
    now,
    coverageStart,
    coverageDays,
    coverageEnd,
    noticeSeconds: latency.calendarLeadSeconds,
    etaDelaySeconds: latency.governanceDelaySeconds * (hybridGovernance ? 2 : 1),
    expirySeconds: latency.operationExpirySeconds,
  });
  if (!plan.ok) {
    console.error('Timeline is not viable:');
    for (const violation of plan.violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  const year = new Date(coverageStart * 1000).getUTCFullYear();

  const intervals = buildEtMarketIntervals(coverageStart, coverageEnd);
  const provenanceHash = keccak256(stringToHex('BELL_RH_245_NYSE_2026_2028_V2'));
  const capabilityMask = Number(env.BELL_CAPABILITY_MASK || 0b11110); // PRE + REGULAR + POST + OVERNIGHT
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
      sourceRightsEvidenceHash: keccak256(stringToHex('BELL_PUBLIC_NYSE_CALENDAR_2026_2028')),
      sources: [{ sourceId: 'nyse-calendar', version: '2026-2028', hash: provenanceHash }],
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

  const metadata = {
    root: dataset.merkleRoot,
    leafCount: dataset.leafCount,
    coverageStart: BigInt(coverageStart),
    coverageEnd: BigInt(coverageEnd),
    queuedAt: 0n,
    executableAt: 0n,
    datasetHash: dataset.datasetHash,
  };

  if (hybridGovernance) {
    const call = buildCalendarRootGovernanceCall({ calendarRegistry, assetId, metadata });
    const queued = await queueHybridGovernanceCall(call);
    if (queued.status === 'SIMULATED') {
      console.log('No transaction sent. Add --broadcast --i-authorize-spend to queue the signed governance call.');
      process.exit(0);
    }
    writeState({
      chainId, assetId, calendarRegistry, governanceOperationId: queued.operationId,
      governanceQueuedTxHash: queued.hash, governanceEta: queued.eta,
      root: dataset.merkleRoot, datasetHash: dataset.datasetHash, leafCount: dataset.leafCount,
      year, coverageStart, coverageEnd, queuedAt: now, stage: 'GOVERNANCE_QUEUED',
      sourceMode: 'HybridAuth-SafetyControllerV2',
    });
    console.log('After the governance ETA, run `mainnet-calendar.mjs execute-governance` to queue the root.');
    process.exit(0);
  }

  const { hash, receipt } = await simulateAndSend({
    address: calendarRegistry,
    abi: CALENDAR_ABI,
    functionName: 'queueRoot',
    args: [assetId, metadata],
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
} else if (command === 'execute-governance') {
  const state = readState();
  if (!state?.governanceOperationId) throw new Error('no pending governance call in state; run `queue` first');
  if (!hybridGovernance) throw new Error('deployment does not expose SafetyControllerV2 governance execution');
  const [kind, , eta, expiry, status] = await publicClient.readContract({
    address: manifest.safetyController, abi: SAFETY_HYBRID_ABI,
    functionName: 'operation', args: [state.governanceOperationId],
  });
  console.log(`governance operation kind=${kind} eta=${eta} expiry=${expiry} status=${status}`);
  if (Number(status) !== 1) throw new Error(`governance operation status is ${status}, expected QUEUED`);
  if (BigInt(now) < BigInt(eta)) throw new Error(`Too early: execute after ${new Date(Number(eta) * 1000).toISOString()}`);
  if (BigInt(now) > BigInt(expiry)) throw new Error('governance operation expired; re-plan the calendar root');

  const { hash, receipt } = await simulateAndSend({
    address: manifest.safetyController, abi: SAFETY_HYBRID_ABI,
    functionName: 'executeGovernanceCall', args: [state.governanceOperationId],
  }, 'executeGovernanceCall');
  const rootEvent = parseEventLogs({ abi: CALENDAR_ABI, logs: receipt.logs, eventName: 'RootQueued' })
    .find((entry) => entry.args.assetId.toLowerCase() === assetId.toLowerCase());
  if (!rootEvent) throw new Error('CalendarRegistry RootQueued event missing from governance execution receipt');
  const [, , rootEta, rootExpiry, rootStatus] = await publicClient.readContract({
    address: calendarRegistry, abi: CALENDAR_ABI, functionName: 'operation', args: [rootEvent.args.operationId],
  });
  writeState({
    ...state, rootOperationId: rootEvent.args.operationId,
    rootQueuedTxHash: hash, rootEta: Number(rootEta), rootExpiry: Number(rootExpiry),
    stage: Number(rootStatus) === 2 ? 'ROOT_ACTIVE' : 'QUEUED',
  });
  console.log(`Calendar root queued: ${rootEvent.args.operationId}; eta ${new Date(Number(rootEta) * 1000).toISOString()}`);
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
  const provenanceHash = keccak256(stringToHex('BELL_RH_245_NYSE_2026_2028_V2'));
  const dataset = buildCalendarDataset({
    schemaVersion: 1,
    chainId: String(chainId),
    calendarRegistry,
    assetId,
    year: state.year,
    coverageStart: String(state.coverageStart),
    coverageEnd: String(state.coverageEnd),
    capabilityMask: Number(env.BELL_CAPABILITY_MASK || 0b11110),
    datasetProvenance: {
      timezone: 'America/New_York',
      timezoneDatabaseVersion: '2026a',
      sourceRightsEvidenceHash: keccak256(stringToHex('BELL_PUBLIC_NYSE_CALENDAR_2026_2028')),
      sources: [{ sourceId: 'nyse-calendar', version: '2026-2028', hash: provenanceHash }],
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
  console.error(`Unknown command "${command}". Use plan | queue | execute-governance | activate-root | activate-interval | status`);
  process.exit(1);
}
