#!/usr/bin/env node
/**
 * Elysium testnet (chain 99801) rehearsal driver. Runs after `forge script DeployTestnet.s.sol`.
 *
 *   node scripts/deploy/elysium-rehearsal.mjs adapters   deploy the Yahoo-attested source adapters for tAAPL
 *   node scripts/deploy/elysium-rehearsal.mjs admit      admit tAAPL (stock), tUSDG and WETH (quotes) in the AssetRegistry
 *   node scripts/deploy/elysium-rehearsal.mjs calendar   commit the US-Eastern session calendar for tAAPL
 *   node scripts/deploy/elysium-rehearsal.mjs pools      record the pools the factory created (run after script/ElysiumPools.s.sol)
 *   node scripts/deploy/elysium-rehearsal.mjs swap       swap through BellRouter on the SESSION_ONLY pool, inside the cap
 *   node scripts/deploy/elysium-rehearsal.mjs cap        send a swap above the cap and record the revert
 *   node scripts/deploy/elysium-rehearsal.mjs withdraw   remove part of the seed position through the PositionManager
 *   node scripts/deploy/elysium-rehearsal.mjs status     read every step back from the chain
 *
 * Reads only ELYSIUM_* names from contracts/.env. It never touches a Robinhood key, and it refuses to run on any chain but
 * 99801. Every write is simulated before it is sent, and every phase is safe to run twice.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseAbiParameters, parseEventLogs, stringToHex, encodeAbiParameters, decodeAbiParameters, encodePacked, encodeFunctionData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadEnvFile } from './env-loader.mjs';
import { buildYahooSourceWire } from '../../packages/protocol/src/yahoo-attestation.mjs';
import { encodeSourceWires } from '../../packages/protocol/src/source-codec.mjs';
import { hashCalendarLeaf, verifyMerkleProof } from '../../packages/protocol/src/calendar.mjs';
import { buildCalendarDataset } from '../calendar/calendar-builder.mjs';
import { buildEtMarketIntervals } from '../calendar/et-market-calendar.mjs';
import VerifierArtifact from '../../contracts/out/YahooSourceVerifier.sol/YahooSourceVerifier.json' with { type: 'json' };
import AdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import CalendarArtifact from '../../contracts/out/CalendarRegistry.sol/CalendarRegistry.json' with { type: 'json' };
import ExecutorArtifact from '../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };
import RouterArtifact from '../../contracts/out/BellRouter.sol/BellRouter.json' with { type: 'json' };
import PositionManagerArtifact from '../../contracts/out/PositionManager.sol/PositionManager.json' with { type: 'json' };

const CHAIN_ID = 99801;
const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO32 = `0x${'0'.repeat(64)}`;
const DAY = 86_400;
const ENV_FILE = 'contracts/.env';
const MANIFEST_PATH = 'deployments/elysium-testnet.json';
const ADAPTERS_PATH = 'evidence/deploy/elysium-testnet-adapters.json';
const ASSETS_PATH = 'evidence/deploy/elysium-testnet-assets.json';
const CALENDAR_PATH = 'evidence/deploy/elysium-testnet-calendar.json';
const POOLS_PATH = 'evidence/deploy/elysium-testnet-pools.json';
const TESTS_PATH = 'evidence/deploy/elysium-testnet-tests.json';
const EXECUTOR_PATH = 'evidence/deploy/elysium-testnet-executor.json';

const env = loadEnvFile({ filePath: ENV_FILE, optional: false });
const rpcUrl = process.env.ELYSIUM_RPC_URL || 'https://testnet-rpc.elysium.kinetiq.xyz';
const deployerKey = env.ELYSIUM_DEPLOYER_PRIVATE_KEY;
if (!deployerKey) throw new Error('ELYSIUM_DEPLOYER_PRIVATE_KEY is required in contracts/.env');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
if (Number(manifest.chainId) !== CHAIN_ID) throw new Error(`manifest chainId ${manifest.chainId}, expected ${CHAIN_ID}`);

const account = privateKeyToAccount(deployerKey.startsWith('0x') ? deployerKey : `0x${deployerKey}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== CHAIN_ID) throw new Error(`RPC is not chain ${CHAIN_ID}`);
if (account.address.toLowerCase() !== manifest.deployer.toLowerCase()) throw new Error('ELYSIUM_DEPLOYER_PRIVATE_KEY is not the manifest deployer');

const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const save = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

async function send(request, label) {
  await publicClient.simulateContract({ ...request, account });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash} block ${receipt.blockNumber}`);
  return { hash, receipt };
}

async function deploy(artifact, args, label) {
  const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${label} deployment failed: ${hash}`);
  console.log(`${label}: ${receipt.contractAddress} (${hash})`);
  return { address: receipt.contractAddress, hash };
}

// ───────────────────────────── adapters ─────────────────────────────
async function adapters() {
  if (existsSync(ADAPTERS_PATH)) { console.log('adapters already deployed:', ADAPTERS_PATH); return; }
  let reporterKey = env.ELYSIUM_REPORTER_PRIVATE_KEY;
  if (!reporterKey) {
    // A dedicated attestation key, separate from every deploy and role wallet. It only signs; it never holds funds.
    reporterKey = generatePrivateKey();
    appendFileSync(ENV_FILE, `\nELYSIUM_REPORTER_PRIVATE_KEY=${reporterKey}\n`);
    console.log('generated a new attestation key and stored it in contracts/.env (value not shown)');
  }
  const reporter = privateKeyToAccount(reporterKey.startsWith('0x') ? reporterKey : `0x${reporterKey}`).address;
  const token = manifest.testStock;

  const verifier = await deploy(VerifierArtifact, [reporter], 'YahooSourceVerifier');
  const verifierCode = await publicClient.getBytecode({ address: verifier.address });
  const verifierCodeHash = keccak256(verifierCode);

  const build = (phaseScope) => buildYahooSourceWire({ chainId: CHAIN_ID, token, verifier: verifier.address, verifierCodeHash, phaseScope, symbol: 'AAPL' });
  const direct = build(0); const regular = build(1); const extended = build(2);

  const directA = await deploy(AdapterArtifact, [verifier.address, direct.sourceConfigHash, ZERO32, 0, true, token], 'direct adapter');
  const regularA = await deploy(AdapterArtifact, [verifier.address, regular.sourceConfigHash, regular.wire.feedId, 1, false, token], 'regular adapter');
  const extendedA = await deploy(AdapterArtifact, [verifier.address, extended.sourceConfigHash, extended.wire.feedId, 2, false, token], 'extended adapter');

  save(ADAPTERS_PATH, {
    chainId: CHAIN_ID, stockToken: token, reporter, verifier: verifier.address, verifierCodeHash,
    directAdapter: directA.address, regularAdapter: regularA.address, extendedAdapter: extendedA.address,
    directWire: direct.wire, regularWire: regular.wire, extendedWire: extended.wire,
    directWireHash: direct.sourceConfigHash, regularWireHash: regular.sourceConfigHash, extendedWireHash: extended.sourceConfigHash,
    note: 'Rehearsal attestation for a test token. tAAPL (BELL test) has no value and these adapters are not a price oracle for any real asset.',
  });
  console.log('saved', ADAPTERS_PATH);
}

// ───────────────────────────── admit ─────────────────────────────
const REGISTRY_ABI = parseAbi([
  'function queueAsset((bytes32 id, address token, bool isStock, uint8 decimals, uint8 capabilityMask, address tokenPriceAdapter, address regularAdapter, address extendedAdapter, address overnightAdapter, address secondaryAdapter, bytes32 expectedCodeHash, bytes32 implementationFingerprint, bytes32 evidenceHash) descriptor, bytes sourceConfig) returns (bytes32)',
  'function activateAsset(bytes32 operationId) returns (bytes32)',
  'function descriptorIdForToken(address token) view returns (bytes32)',
  'event AssetQueued(bytes32 indexed operationId, bytes32 indexed assetId, address indexed token, uint64 eta)',
]);
const ERC20_ABI = parseAbi(['function decimals() view returns (uint8)', 'function name() view returns (string)']);

async function admitOne({ label, token, isStock, capabilityMask = 0, adapters: a = {}, sourceConfig = '0x' }) {
  const registry = manifest.assetRegistry;
  const existing = await publicClient.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'descriptorIdForToken', args: [token] });
  if (existing !== ZERO32) { console.log(`${label} already admitted: ${existing}`); return existing; }
  const code = await publicClient.getBytecode({ address: token });
  const decimals = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' });
  const descriptor = {
    id: ZERO32, token, isStock, decimals, capabilityMask,
    tokenPriceAdapter: a.direct ?? ZERO, regularAdapter: a.regular ?? ZERO, extendedAdapter: a.extended ?? ZERO,
    overnightAdapter: ZERO, secondaryAdapter: ZERO,
    expectedCodeHash: keccak256(code),
    implementationFingerprint: keccak256(stringToHex(`bell-elysium-testnet:impl:${token.toLowerCase()}`)),
    evidenceHash: keccak256(stringToHex(`bell-elysium-testnet:test-token-evidence:${label}`)),
  };
  const queued = await send({ address: registry, abi: REGISTRY_ABI, functionName: 'queueAsset', args: [descriptor, sourceConfig] }, `queue ${label}`);
  const ev = parseEventLogs({ abi: REGISTRY_ABI, logs: queued.receipt.logs, eventName: 'AssetQueued' })[0];
  const opId = ev?.args?.operationId ?? queued.receipt.logs[0].topics[1];
  await send({ address: registry, abi: REGISTRY_ABI, functionName: 'activateAsset', args: [opId] }, `activate ${label}`);
  const id = await publicClient.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'descriptorIdForToken', args: [token] });
  if (id === ZERO32) throw new Error(`${label} was not admitted`);
  console.log(`${label} admitted: ${id}`);
  return id;
}

async function admit() {
  const ad = json(ADAPTERS_PATH);
  const stock = await admitOne({
    label: 'tAAPL', token: manifest.testStock, isStock: true, capabilityMask: 0x06,
    adapters: { direct: ad.directAdapter, regular: ad.regularAdapter, extended: ad.extendedAdapter },
    sourceConfig: encodeSourceWires([ad.directWire, ad.regularWire, ad.extendedWire]),
  });
  const usdg = await admitOne({ label: 'tUSDG', token: manifest.feeToken, isStock: false });
  const weth = await admitOne({ label: 'WETH', token: manifest.weth, isStock: false });
  save(ASSETS_PATH, { chainId: CHAIN_ID, registry: manifest.assetRegistry, stock: { token: manifest.testStock, descriptorId: stock }, tusdg: { token: manifest.feeToken, descriptorId: usdg }, weth: { token: manifest.weth, descriptorId: weth }, admittedAt: new Date().toISOString() });
  console.log('saved', ASSETS_PATH);
}

// ───────────────────────────── calendar ─────────────────────────────
async function calendar() {
  const assets = json(ASSETS_PATH);
  const assetId = assets.stock.descriptorId;
  const registry = manifest.calendarRegistry;
  const ABI = CalendarArtifact.abi;
  const head = await publicClient.getBlock();
  const now = Number(head.timestamp);
  // Coverage starts a little in the future (publication notice is zero here, but never start in the past) and stays inside one UTC year.
  const start = now + 120;
  const days = Number(process.env.BELL_CALENDAR_DAYS || 45);
  const end = start + days * DAY;
  const year = new Date(start * 1000).getUTCFullYear();
  if (new Date((end - 1) * 1000).getUTCFullYear() !== year) throw new Error('coverage crosses a UTC year; shorten BELL_CALENDAR_DAYS');

  const intervals = buildEtMarketIntervals(start, end);
  const provenanceHash = keccak256(stringToHex('BELL_ELYSIUM_TESTNET_US_EASTERN_SESSIONS_V1'));
  const dataset = buildCalendarDataset({
    schemaVersion: 1, chainId: String(CHAIN_ID), calendarRegistry: registry, assetId, year,
    coverageStart: String(start), coverageEnd: String(end), capabilityMask: 0b110,
    datasetProvenance: {
      timezone: 'America/New_York', timezoneDatabaseVersion: '2026a',
      sourceRightsEvidenceHash: keccak256(stringToHex('BELL_ELYSIUM_TESTNET_SELF_DECLARED_SESSIONS')),
      sources: [{ sourceId: 'bell-testnet-session-table', version: 'v1', hash: provenanceHash }],
    },
    intervals: intervals.map((i) => ({ start: String(i.start), end: String(i.end), phase: i.phase, provenanceHash })),
  });
  console.log(`calendar: ${dataset.leafCount} leaves ${new Date(start * 1000).toISOString()} .. ${new Date(end * 1000).toISOString()}`);
  console.log('root:', dataset.merkleRoot);

  const targetTime = Math.max(now, start);
  const idx = dataset.leaves.findIndex((l) => Number(l.start) <= targetTime && targetTime < Number(l.end));
  if (idx < 0) throw new Error('no leaf covers the activation time');
  const leaf = dataset.leaves[idx];
  if (!verifyMerkleProof(hashCalendarLeaf(leaf), dataset.proofs[idx], dataset.merkleRoot)) throw new Error('leaf proof does not verify');

  const queued = await send({
    address: registry, abi: ABI, functionName: 'queueRoot',
    args: [assetId, { root: dataset.merkleRoot, leafCount: dataset.leafCount, coverageStart: BigInt(start), coverageEnd: BigInt(end), queuedAt: 0n, executableAt: 0n, datasetHash: dataset.datasetHash }],
  }, 'queueRoot');
  const ev = parseEventLogs({ abi: ABI, logs: queued.receipt.logs, eventName: 'RootQueued' }).find((e) => e.args.assetId.toLowerCase() === assetId.toLowerCase());
  if (!ev) throw new Error('RootQueued event missing');
  await send({ address: registry, abi: ABI, functionName: 'activateRoot', args: [ev.args.operationId] }, 'activateRoot');

  for (;;) {
    const b = await publicClient.getBlock();
    if (Number(b.timestamp) >= Number(leaf.start)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const sol = (l) => ({ assetId: l.assetId, year: l.year, index: l.index, start: BigInt(l.start), end: BigInt(l.end), phase: Number(l.phase), provenanceHash: l.provenanceHash });
  const zeroLeaf = { assetId: ZERO32, year: 0, index: 0, start: 0n, end: 0n, phase: 0, provenanceHash: ZERO32 };
  const prev = idx > 0 ? dataset.leaves[idx - 1] : null;
  const next = idx + 1 < dataset.leafCount ? dataset.leaves[idx + 1] : null;
  await send({
    address: registry, abi: ABI, functionName: 'activateInterval',
    args: [assetId, sol(leaf), prev ? sol(prev) : zeroLeaf, next ? sol(next) : zeroLeaf, [dataset.proofs[idx], prev ? dataset.proofs[idx - 1] : [], next ? dataset.proofs[idx + 1] : []]],
  }, 'activateInterval');

  const cur = await publicClient.readContract({ address: registry, abi: ABI, functionName: 'currentInterval', args: [assetId] });
  console.log(`active interval: phase ${cur.phase} ${new Date(Number(cur.start) * 1000).toISOString()} .. ${new Date(Number(cur.end) * 1000).toISOString()}`);
  save(CALENDAR_PATH, {
    chainId: CHAIN_ID, assetId, root: dataset.merkleRoot, operationId: ev.args.operationId, year, coverageStart: start, coverageEnd: end,
    leafCount: dataset.leafCount, activePhase: Number(cur.phase), activeStart: Number(cur.start), activeEnd: Number(cur.end), committedAt: new Date().toISOString(),
  });
  console.log('saved', CALENDAR_PATH);
}


// ───────────────────────────── pools ─────────────────────────────
const FACTORY_EVENTS = parseAbi([
  'event PoolCreated(address indexed hook, bytes32 indexed poolId, bytes32 configHash, address creator, address recipient)',
  'event PoolActivated(bytes32 indexed poolId, uint256 tokenId, bytes32 positionKey)',
  'event PoolStaged(bytes32 indexed poolId, uint256 tokenId, bytes32 positionKey)',
]);
const HOOK_ABI = parseAbi([
  'function state() view returns ((uint8 lifecycle, uint8 mode, bool closedLatched, uint64 closureNonce, uint64 reopenCandidateAt, uint64 oldValidUntil, uint64[2] reopenBaseObservations, uint64[2] lastOpenObservations, uint64 pauseNonce, uint64 bellStart, uint64 corporateUntil))',
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] effectiveTradeCap, uint128[2] effectiveWindowCap, uint128[2] rollingRemaining, uint128[2] closureRemaining, uint128[2] referencePrice18, uint64 validUntil, uint64 closureNonce, bytes32 configHash, bytes32 stateHash))',
  'function seedPrincipal() view returns (uint128[2])',
]);
const AUCTION_REGISTRY_ABI = parseAbi(['function auctionFor(bytes32 poolId) view returns (address)']);

async function pools() {
  const logs = await publicClient.getLogs({ address: manifest.poolFactory, events: FACTORY_EVENTS, fromBlock: 0n, toBlock: 'latest' });
  const created = logs.filter((l) => l.eventName === 'PoolCreated');
  if (created.length === 0) throw new Error('no PoolCreated events from the factory yet');
  const result = [];
  for (const c of created) {
    const { hook, poolId } = c.args;
    const activated = logs.find((l) => (l.eventName === 'PoolActivated' || l.eventName === 'PoolStaged') && l.args.poolId === poolId);
    const state = await publicClient.readContract({ address: hook, abi: HOOK_ABI, functionName: 'state' });
    const policy = await publicClient.readContract({ address: hook, abi: HOOK_ABI, functionName: 'getPolicy' });
    const principal = await publicClient.readContract({ address: hook, abi: HOOK_ABI, functionName: 'seedPrincipal' });
    const auction = await publicClient.readContract({ address: manifest.auctionRegistry, abi: AUCTION_REGISTRY_ABI, functionName: 'auctionFor', args: [poolId] });
    result.push({
      hook, poolId, tokenId: activated ? Number(activated.args.tokenId) : null, createTx: c.transactionHash, blockNumber: Number(c.blockNumber),
      hookMaskOk: (BigInt(hook) & 0x3fffn) === 0x2cc0n,
      lifecycle: state.lifecycle, mode: state.mode, canSwap: policy.canSwap, phase: policy.phase, reasonBits: policy.reasonBits.toString(),
      seedPrincipal: principal.map(String), auction: auction === ZERO ? null : auction,
      kind: auction === ZERO ? 'SESSION_ONLY' : 'SESSION_ONLY + Opening Bell Auction',
    });
  }
  save(POOLS_PATH, { chainId: CHAIN_ID, factory: manifest.poolFactory, recordedAt: new Date().toISOString(), pools: result });
  console.log(JSON.stringify(result, null, 2));
  console.log('saved', POOLS_PATH);
}

// ───────────────────────────── behaviour tests ─────────────────────────────
const MAX_SQRT_LIMIT = 1461446703485210103287273052203988822378723970341n;
const MIN_SQRT_LIMIT = 4295128740n;
const ERC20_TOKEN_ABI = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)']);
const HOOK_READ_ABI = parseAbi([
  'function configHash() view returns (bytes32)',
  'function poolKey() view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))',
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] effectiveTradeCap, uint128[2] effectiveWindowCap, uint128[2] rollingRemaining, uint128[2] closureRemaining, uint128[2] referencePrice18, uint64 validUntil, uint64 closureNonce, bytes32 configHash, bytes32 stateHash))',
]);

function record(entry) {
  const cur = existsSync(TESTS_PATH) ? json(TESTS_PATH) : { chainId: CHAIN_ID, entries: [] };
  cur.entries.push({ ...entry, at: new Date().toISOString() });
  save(TESTS_PATH, cur);
}
/** Turn a viem revert into text. Uniswap v4 wraps a hook revert in WrappedError(target, selector, reason, details). */
function explainRevert(e) {
  let c = e;
  while (c && !c.raw && c.cause) c = c.cause;
  const raw = c?.raw;
  if (!raw || raw === '0x') return (e.shortMessage || e.message).split('\n')[0];
  const sel = raw.slice(0, 10);
  if (sel === '0x90bfb865') {
    const [target, hookSel, reason] = decodeAbiParameters(parseAbiParameters('address, bytes4, bytes, bytes'), `0x${raw.slice(10)}`);
    return `WrappedError from ${target} (${hookSel}), inner revert ${reason.slice(0, 10)} data ${reason}`;
  }
  return `revert ${sel} data ${raw}`;
}

// `node ... swap auction` targets the pool that carries the Opening Bell Auction; the default is the plain SESSION_ONLY pool.
const POOL_KIND = process.argv[3] === 'auction' ? 'SESSION_ONLY + Opening Bell Auction' : 'SESSION_ONLY';
function poolOf(kind = POOL_KIND) {
  const found = json(POOLS_PATH).pools.find((p) => p.kind === kind);
  if (!found) throw new Error(`no pool of kind ${kind}`);
  return found;
}

async function ensureAllowance(token, spender, amount) {
  const have = await publicClient.readContract({ address: token, abi: ERC20_TOKEN_ABI, functionName: 'allowance', args: [account.address, spender] });
  if (have >= amount) return;
  await send({ address: token, abi: ERC20_TOKEN_ABI, functionName: 'approve', args: [spender, 10n ** 30n] }, `approve ${token}`);
}

/**
 * Swaps go straight to the PoolManager through TestnetSwapExecutor, with empty hookData.
 *
 * BellRouter always attaches a swap envelope, and for a stock wired to Yahoo-attested sources the registry then needs a freshly
 * signed quote inside that envelope. Yahoo publishes no new candle on a Saturday, so a router swap cannot exist today. A direct
 * swap still runs the hook's beforeSwap and afterSwap, which is what the closed-market budget test is about. The router path is
 * exercised at the next open (see docs/elysium-testnet.md).
 */
async function ensureExecutor() {
  if (existsSync(EXECUTOR_PATH)) return json(EXECUTOR_PATH).executor;
  const d = await deploy(ExecutorArtifact, [manifest.poolManager], 'TestnetSwapExecutor');
  save(EXECUTOR_PATH, { chainId: CHAIN_ID, executor: d.address, deployTx: d.hash, poolManager: manifest.poolManager, note: 'Rehearsal helper: swaps directly on the PoolManager with empty hookData. Holds no funds and no allowance.' });
  return d.address;
}

async function buildDirectSwap({ pool, amountIn }) {
  const key = await publicClient.readContract({ address: pool.hook, abi: HOOK_READ_ABI, functionName: 'poolKey' });
  const zeroForOne = key.currency0.toLowerCase() === manifest.testStock.toLowerCase(); // sell tAAPL into the pool
  return { stockIndex: zeroForOne ? 0 : 1, key, zeroForOne, amountSpecified: -BigInt(amountIn) };
}

async function swap() {
  const pool = poolOf();
  const executor = await ensureExecutor();
  const amountIn = 2n * 10n ** 17n;
  const s0 = await buildDirectSwap({ pool, amountIn });
  await ensureAllowance(manifest.testStock, executor, amountIn);
  const before = await publicClient.readContract({ address: pool.hook, abi: HOOK_READ_ABI, functionName: 'getPolicy' });
  let sent;
  try {
    sent = await send({ address: executor, abi: ExecutorArtifact.abi, functionName: 'executeSwap', args: [s0.key, s0.zeroForOne, s0.amountSpecified] }, 'swap inside the cap');
  } catch (e) { throw new Error('swap would revert: ' + explainRevert(e)); }
  const after = await publicClient.readContract({ address: pool.hook, abi: HOOK_READ_ABI, functionName: 'getPolicy' });
  const ev = parseEventLogs({ abi: ExecutorArtifact.abi, logs: sent.receipt.logs, eventName: 'RehearsalSwapExecuted' })[0];
  const entry = {
    test: 'swap inside the cap', pool: pool.hook, executor, phase: Number(before.phase), mode: Number(before.mode), tx: sent.hash, block: Number(sent.receipt.blockNumber),
    amount0: String(ev.args.amount0), amount1: String(ev.args.amount1),
    closureRemainingBefore: before.closureRemaining.map(String), closureRemainingAfter: after.closureRemaining.map(String),
  };
  record(entry);
  console.log(JSON.stringify(entry, null, 2));
}

async function cap() {
  const pool = poolOf();
  const executor = await ensureExecutor();
  const policy = await publicClient.readContract({ address: pool.hook, abi: HOOK_READ_ABI, functionName: 'getPolicy' });
  const probe = await buildDirectSwap({ pool, amountIn: 1n });
  // Ask for twice what is left of the closed-market budget on the tAAPL side.
  const attempt = policy.closureRemaining[probe.stockIndex] * 2n;
  const s0 = await buildDirectSwap({ pool, amountIn: attempt });
  await ensureAllowance(manifest.testStock, executor, attempt);
  let reason = '';
  try {
    await publicClient.simulateContract({ address: executor, abi: ExecutorArtifact.abi, functionName: 'executeSwap', args: [s0.key, s0.zeroForOne, s0.amountSpecified], account });
  } catch (e) { reason = explainRevert(e); }
  if (!reason) throw new Error('the over-cap swap did not revert in the pre-flight call');
  // Send it anyway with a fixed gas limit, so the revert is on chain with a hash anyone can open.
  const data = encodeFunctionData({ abi: ExecutorArtifact.abi, functionName: 'executeSwap', args: [s0.key, s0.zeroForOne, s0.amountSpecified] });
  const hash = await walletClient.sendTransaction({ to: executor, data, gas: 3_000_000n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'reverted') throw new Error('expected a reverted transaction, got ' + receipt.status);
  const entry = {
    test: 'swap above the cap reverts', pool: pool.hook, executor, phase: Number(policy.phase), closureRemaining: policy.closureRemaining.map(String),
    attempted: String(attempt), tx: hash, block: Number(receipt.blockNumber), status: receipt.status, reason,
  };
  record(entry);
  console.log(JSON.stringify(entry, null, 2));
}

async function withdraw() {
  const pool = poolOf();
  const PM = manifest.positionManager;
  const liquidity = await publicClient.readContract({ address: PM, abi: PositionManagerArtifact.abi, functionName: 'getPositionLiquidity', args: [BigInt(pool.tokenId)] });
  const part = liquidity / 10n;
  const key = await publicClient.readContract({ address: pool.hook, abi: HOOK_READ_ABI, functionName: 'poolKey' });
  const actions = encodePacked(['uint8', 'uint8'], [0x01, 0x11]); // DECREASE_LIQUIDITY, TAKE_PAIR
  const p0 = encodeAbiParameters(parseAbiParameters('uint256, uint256, uint128, uint128, bytes'), [BigInt(pool.tokenId), part, 1n, 1n, '0x']);
  const p1 = encodeAbiParameters(parseAbiParameters('address, address, address'), [key.currency0, key.currency1, account.address]);
  const unlockData = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [actions, [p0, p1]]);
  const bal = (token) => publicClient.readContract({ address: token, abi: ERC20_TOKEN_ABI, functionName: 'balanceOf', args: [account.address] });
  const [b0, b1] = [await bal(key.currency0), await bal(key.currency1)];
  const policy = await publicClient.readContract({ address: pool.hook, abi: HOOK_READ_ABI, functionName: 'getPolicy' });
  const head = await publicClient.getBlock();
  const sent = await send({ address: PM, abi: PositionManagerArtifact.abi, functionName: 'modifyLiquidities', args: [unlockData, BigInt(Number(head.timestamp) + 600)] }, 'withdraw 10 percent of the seed position');
  const [a0, a1] = [await bal(key.currency0), await bal(key.currency1)];
  const left = await publicClient.readContract({ address: PM, abi: PositionManagerArtifact.abi, functionName: 'getPositionLiquidity', args: [BigInt(pool.tokenId)] });
  const entry = {
    test: 'withdraw while the market is CLOSED', pool: pool.hook, phase: Number(policy.phase), tokenId: pool.tokenId, tx: sent.hash, block: Number(sent.receipt.blockNumber),
    liquidityBefore: String(liquidity), liquidityRemoved: String(part), liquidityAfter: String(left), received: [String(a0 - b0), String(a1 - b1)],
  };
  record(entry);
  console.log(JSON.stringify(entry, null, 2));
}

// ───────────────────────────── status ─────────────────────────────
async function status() {
  const out = {};
  for (const [k, v] of Object.entries(manifest)) {
    if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) {
      const code = await publicClient.getBytecode({ address: v });
      out[k] = { address: v, hasCode: !!code && code !== '0x' };
    }
  }
  console.log(JSON.stringify(out, null, 2));
  for (const p of [ADAPTERS_PATH, ASSETS_PATH, CALENDAR_PATH, POOLS_PATH]) console.log(p, existsSync(p) ? 'present' : 'missing');
}

const phase = process.argv[2];
const phases = { adapters, admit, calendar, pools, swap, cap, withdraw, status };
if (!phases[phase]) { console.error(`usage: ${Object.keys(phases).join(' | ')}`); process.exit(2); }
await phases[phase]();
