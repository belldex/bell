#!/usr/bin/env node
/**
 * Elysium testnet: a compressed-session rehearsal that exercises the Opening Bell Auction and every supported session in about
 * ninety minutes, instead of waiting for the real Monday open.
 *
 *   node scripts/deploy/elysium-session-rehearsal.mjs setup    second test stock (tNVDA), its adapters, admission and a compressed calendar
 *   node scripts/deploy/elysium-session-rehearsal.mjs record   record the pool that scripts/ElysiumPools.s.sol created for it
 *   node scripts/deploy/elysium-session-rehearsal.mjs drive    run the whole timeline: arm, orders, blocked swap, settle, claims, PRE and REGULAR swaps
 *   node scripts/deploy/elysium-session-rehearsal.mjs status   print the current stage
 *
 * The calendar here is a REHEARSAL table (CLOSED 30 min, PRE 15, REGULAR 20, CLOSED 25) committed for a separate test asset.
 * It is not a market calendar and it never replaces the US-Eastern calendar committed for tAAPL. Reads only ELYSIUM_* names from
 * contracts/.env, accepts only chain 99801, and every write is simulated before it is sent.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEventLogs, stringToHex, decodeAbiParameters,
  parseAbiParameters, encodeFunctionData, encodeAbiParameters, encodePacked,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadEnvFile } from './env-loader.mjs';
import { buildYahooSourceWire } from '../../packages/protocol/src/yahoo-attestation.mjs';
import { encodeSourceWires } from '../../packages/protocol/src/source-codec.mjs';
import { buildCalendarDataset } from '../calendar/calendar-builder.mjs';
import TestTokenArtifact from '../../contracts/out/TestToken.sol/TestToken.json' with { type: 'json' };
import AdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import CalendarArtifact from '../../contracts/out/CalendarRegistry.sol/CalendarRegistry.json' with { type: 'json' };
import PositionManagerArtifact from '../../contracts/out/PositionManager.sol/PositionManager.json' with { type: 'json' };
import ExecutorArtifact from '../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };

const CHAIN_ID = 99801;
const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO32 = `0x${'0'.repeat(64)}`;
const ENV_FILE = 'contracts/.env';
const MANIFEST = JSON.parse(readFileSync('deployments/elysium-testnet.json', 'utf8'));
const ADAPTERS = JSON.parse(readFileSync('evidence/deploy/elysium-testnet-adapters.json', 'utf8'));
const EXECUTOR = JSON.parse(readFileSync('evidence/deploy/elysium-testnet-executor.json', 'utf8')).executor;
const STATE_PATH = 'evidence/deploy/elysium-testnet-rehearsal.json';
const POOLS_PATH = 'evidence/deploy/elysium-testnet-pools.json';
const TESTS_PATH = 'evidence/deploy/elysium-testnet-tests.json';

const env = loadEnvFile({ filePath: ENV_FILE, optional: false });
const rpcUrl = process.env.ELYSIUM_RPC_URL || 'https://testnet-rpc.elysium.kinetiq.xyz';
const deployerKey = env.ELYSIUM_DEPLOYER_PRIVATE_KEY;
if (!deployerKey) throw new Error('ELYSIUM_DEPLOYER_PRIVATE_KEY is required in contracts/.env');
const account = privateKeyToAccount(deployerKey.startsWith('0x') ? deployerKey : `0x${deployerKey}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== CHAIN_ID) throw new Error(`RPC is not chain ${CHAIN_ID}`);
if (account.address.toLowerCase() !== MANIFEST.deployer.toLowerCase()) throw new Error('key is not the manifest deployer');

const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const save = (p, v) => writeFileSync(p, `${JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function send(request, label) {
  await publicClient.simulateContract({ ...request, account });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  log(`${label}: ${hash} block ${receipt.blockNumber}`);
  return { hash, receipt };
}
async function deploy(artifact, args, label) {
  const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${label} deployment failed: ${hash}`);
  log(`${label}: ${receipt.contractAddress}`);
  return { address: receipt.contractAddress, hash };
}
const chainNow = async () => Number((await publicClient.getBlock()).timestamp);

function record(entry) {
  const cur = existsSync(TESTS_PATH) ? json(TESTS_PATH) : { chainId: CHAIN_ID, entries: [] };
  cur.entries.push({ ...entry, at: new Date().toISOString() });
  save(TESTS_PATH, cur);
}

const REGISTRY_ABI = parseAbi([
  'function queueAsset((bytes32 id, address token, bool isStock, uint8 decimals, uint8 capabilityMask, address tokenPriceAdapter, address regularAdapter, address extendedAdapter, address overnightAdapter, address secondaryAdapter, bytes32 expectedCodeHash, bytes32 implementationFingerprint, bytes32 evidenceHash) descriptor, bytes sourceConfig) returns (bytes32)',
  'function activateAsset(bytes32 operationId) returns (bytes32)',
  'function descriptorIdForToken(address token) view returns (bytes32)',
  'event AssetQueued(bytes32 indexed operationId, bytes32 indexed assetId, address indexed token, uint64 eta)',
]);
const ERC20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function mint(address,uint256)', 'function decimals() view returns (uint8)']);
const HOOK = parseAbi([
  'function poolKey() view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))',
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] effectiveTradeCap, uint128[2] effectiveWindowCap, uint128[2] rollingRemaining, uint128[2] closureRemaining, uint128[2] referencePrice18, uint64 validUntil, uint64 closureNonce, bytes32 configHash, bytes32 stateHash))',
]);
const AUCTION = parseAbi([
  'function armNext() returns (bool)',
  'function currentStage() view returns (uint8)',
  'function cycleId() view returns (uint64)',
  'function openTime() view returns (uint64)',
  'function auctionLead() view returns (uint32)',
  'function cycleSummary(uint64) view returns (uint64 cycleOpenTime, uint64 deadline, uint8 cycleStage, uint160 priceX96, uint128 matchedBase, bool finalized)',
  'function submitOrder(bool isBuyer, uint128 amountIn, uint160 limitPriceX96) returns (uint32)',
  'function settle()',
  'function claimUnfilled(uint64 cycle, uint32 id)',
  'function allocation(uint64 cycle, uint32 id) view returns (uint128 baseFill, uint128 quotePayout, uint128 quoteRefund)',
  'function blocksSwaps() view returns (bool)',
  'function minOrderSizeQuote() view returns (uint128)',
  'function minOrderSizeBase() view returns (uint128)',
  'event OrderSubmitted(uint64 indexed cycleId, uint32 indexed orderId, address indexed owner, bool isBuyer, uint128 amountIn, uint160 limitPriceX96)',
]);
const AUCTION_REGISTRY = parseAbi(['function auctionFor(bytes32 poolId) view returns (address)']);
const STAGE = ['IDLE', 'ARMED', 'OPEN', 'LOCKED', 'SETTLED', 'REFUNDED'];
const PHASE = { 1: 'PRE', 2: 'REGULAR', 3: 'POST', 4: 'OVERNIGHT', 5: 'CLOSED' };

// ───────────────────────────── setup ─────────────────────────────
async function setup() {
  if (existsSync(STATE_PATH)) { log('setup already done:', STATE_PATH); return; }
  // Resumable: an interrupted run leaves its deployed addresses in the partial file and continues from there.
  const PARTIAL = 'evidence/deploy/elysium-testnet-rehearsal-partial.json';
  const part = existsSync(PARTIAL) ? json(PARTIAL) : {};
  let token = part.token;
  if (!token) {
    token = (await deploy(TestTokenArtifact, ['tNVDA (BELL test)', 'tNVDA', 18, account.address, 1_000n * 10n ** 18n], 'tNVDA')).address;
    await send({ address: token, abi: ERC20, functionName: 'mint', args: [account.address, 100_000n * 10n ** 18n] }, 'mint tNVDA');
  }

  const code = await publicClient.getBytecode({ address: token });
  const build = (phaseScope) => buildYahooSourceWire({ chainId: CHAIN_ID, token, verifier: ADAPTERS.verifier, verifierCodeHash: ADAPTERS.verifierCodeHash, phaseScope, symbol: 'NVDA' });
  const direct = build(0); const regular = build(1); const extended = build(2);
  const dA = part.adapters ? { address: part.adapters.direct } : await deploy(AdapterArtifact, [ADAPTERS.verifier, direct.sourceConfigHash, ZERO32, 0, true, token], 'direct adapter');
  const rA = part.adapters ? { address: part.adapters.regular } : await deploy(AdapterArtifact, [ADAPTERS.verifier, regular.sourceConfigHash, regular.wire.feedId, 1, false, token], 'regular adapter');
  const eA = part.adapters ? { address: part.adapters.extended } : await deploy(AdapterArtifact, [ADAPTERS.verifier, extended.sourceConfigHash, extended.wire.feedId, 2, false, token], 'extended adapter');

  const descriptor = {
    id: ZERO32, token, isStock: true, decimals: 18, capabilityMask: 0x06,
    tokenPriceAdapter: dA.address, regularAdapter: rA.address, extendedAdapter: eA.address, overnightAdapter: ZERO, secondaryAdapter: ZERO,
    expectedCodeHash: keccak256(code),
    implementationFingerprint: keccak256(stringToHex(`bell-elysium-testnet:impl:${token.toLowerCase()}`)),
    evidenceHash: keccak256(stringToHex('bell-elysium-testnet:test-token-evidence:tNVDA')),
  };
  let opId = part.opId;
  if (!opId) {
    const queued = await send({ address: MANIFEST.assetRegistry, abi: REGISTRY_ABI, functionName: 'queueAsset', args: [descriptor, encodeSourceWires([direct.wire, regular.wire, extended.wire])] }, 'queue tNVDA');
    // The operation id is the first indexed topic of the registry's queue event.
    opId = queued.receipt.logs[0].topics[1];
  }
  await send({ address: MANIFEST.assetRegistry, abi: REGISTRY_ABI, functionName: 'activateAsset', args: [opId] }, 'activate tNVDA');
  const assetId = await publicClient.readContract({ address: MANIFEST.assetRegistry, abi: REGISTRY_ABI, functionName: 'descriptorIdForToken', args: [token] });
  if (assetId === ZERO32) throw new Error('tNVDA was not admitted');

  // Compressed calendar. Coverage starts shortly after now; the first leaf is CLOSED so the auction can arm at once.
  const now = await chainNow();
  const T0 = now + 150;
  const plan = [['CLOSED', 30], ['PRE', 15], ['REGULAR', 20], ['CLOSED', 25]];
  let cursor = T0;
  const provenanceHash = keccak256(stringToHex('BELL_ELYSIUM_TESTNET_COMPRESSED_REHEARSAL_V1'));
  const intervals = plan.map(([phase, minutes]) => { const start = cursor; cursor += minutes * 60; return { start: String(start), end: String(cursor), phase, provenanceHash }; });
  const year = new Date(T0 * 1000).getUTCFullYear();
  const dataset = buildCalendarDataset({
    schemaVersion: 1, chainId: String(CHAIN_ID), calendarRegistry: MANIFEST.calendarRegistry, assetId, year,
    coverageStart: String(T0), coverageEnd: String(cursor), capabilityMask: 0b110,
    datasetProvenance: {
      timezone: 'America/New_York', timezoneDatabaseVersion: '2026a',
      sourceRightsEvidenceHash: keccak256(stringToHex('BELL_ELYSIUM_TESTNET_COMPRESSED_REHEARSAL_TABLE')),
      sources: [{ sourceId: 'bell-compressed-rehearsal-table', version: 'v1', hash: provenanceHash }],
    },
    intervals,
  });
  const ABI = CalendarArtifact.abi;
  const queuedRoot = await send({
    address: MANIFEST.calendarRegistry, abi: ABI, functionName: 'queueRoot',
    args: [assetId, { root: dataset.merkleRoot, leafCount: dataset.leafCount, coverageStart: BigInt(T0), coverageEnd: BigInt(cursor), queuedAt: 0n, executableAt: 0n, datasetHash: dataset.datasetHash }],
  }, 'queueRoot');
  const ev = parseEventLogs({ abi: ABI, logs: queuedRoot.receipt.logs, eventName: 'RootQueued' }).find((e) => e.args.assetId.toLowerCase() === assetId.toLowerCase());
  await send({ address: MANIFEST.calendarRegistry, abi: ABI, functionName: 'activateRoot', args: [ev.args.operationId] }, 'activateRoot');

  const state = {
    chainId: CHAIN_ID, stock2: token, assetId, adapters: { direct: dA.address, regular: rA.address, extended: eA.address },
    calendar: { year, root: dataset.merkleRoot, operationId: ev.args.operationId, coverageStart: T0, coverageEnd: cursor, plan, leaves: dataset.leaves.map((l) => ({ ...l, start: String(l.start), end: String(l.end) })), proofs: dataset.proofs },
    note: 'REHEARSAL calendar for a separate test asset, compressed to ninety minutes. Not a market calendar.',
    createdAt: new Date().toISOString(),
  };
  save(STATE_PATH, state);
  log('saved', STATE_PATH, 'first leaf starts at', new Date(T0 * 1000).toISOString());
  await advance();
}

const sol = (l) => ({ assetId: l.assetId, year: l.year, index: l.index, start: BigInt(l.start), end: BigInt(l.end), phase: Number(l.phase), provenanceHash: l.provenanceHash });
const zeroLeaf = { assetId: ZERO32, year: 0, index: 0, start: 0n, end: 0n, phase: 0, provenanceHash: ZERO32 };

/** Keeper step: make the registry's current interval the leaf that covers chain time. Safe to call at any time. */
async function advance() {
  const st = json(STATE_PATH);
  const { leaves, proofs } = st.calendar;
  // Before coverage starts there is nothing to activate yet: wait for the first leaf.
  while ((await chainNow()) < Number(leaves[0].start)) await sleep(3000);
  for (;;) {
    const now = await chainNow();
    const idx = leaves.findIndex((l) => Number(l.start) <= now && now < Number(l.end));
    if (idx < 0) { log('no leaf covers chain time', now); return null; }
    const cur = await publicClient.readContract({ address: MANIFEST.calendarRegistry, abi: CalendarArtifact.abi, functionName: 'currentInterval', args: [st.assetId] }).catch(() => null);
    if (cur && Number(cur.index) === idx && cur.assetId.toLowerCase() === st.assetId.toLowerCase()) return idx;
    const prev = idx > 0 ? leaves[idx - 1] : null;
    const next = idx + 1 < leaves.length ? leaves[idx + 1] : null;
    await send({
      address: MANIFEST.calendarRegistry, abi: CalendarArtifact.abi, functionName: 'activateInterval',
      args: [st.assetId, sol(leaves[idx]), prev ? sol(prev) : zeroLeaf, next ? sol(next) : zeroLeaf, [proofs[idx], prev ? proofs[idx - 1] : [], next ? proofs[idx + 1] : []]],
    }, `activateInterval ${idx} (${PHASE[leaves[idx].phase] ?? leaves[idx].phase})`);
    return idx;
  }
}

// ───────────────────────────── pool lookup ─────────────────────────────
async function rehearsalPool() {
  const st = json(STATE_PATH);
  for (const p of json(POOLS_PATH).pools) {
    const key = await publicClient.readContract({ address: p.hook, abi: HOOK, functionName: 'poolKey' });
    if ([key.currency0, key.currency1].some((c) => c.toLowerCase() === st.stock2.toLowerCase())) return { ...p, key };
  }
  throw new Error('no pool for tNVDA recorded yet; run script/ElysiumPools.s.sol with ELYSIUM_POOLS_MODE=1, then elysium-rehearsal.mjs pools');
}

async function ensureAllowance(token, spender, amount) {
  const have = await publicClient.readContract({ address: token, abi: ERC20, functionName: 'allowance', args: [account.address, spender] });
  if (have >= amount) return;
  await send({ address: token, abi: ERC20, functionName: 'approve', args: [spender, 10n ** 30n] }, `approve ${token}`);
}

function decodeRevert(e) {
  let c = e; while (c && !c.raw && c.cause) c = c.cause;
  const raw = c?.raw;
  if (!raw || raw === '0x') return (e.shortMessage || e.message).split('\n')[0];
  if (raw.slice(0, 10) === '0x90bfb865') {
    const [target, sel, reason] = decodeAbiParameters(parseAbiParameters('address, bytes4, bytes, bytes'), `0x${raw.slice(10)}`);
    return `WrappedError from ${target} (${sel}) inner ${reason.slice(0, 10)} data ${reason}`;
  }
  return `revert ${raw}`;
}

/** Sell `amountIn` of tNVDA into the pool through the direct executor (empty hookData). */
async function directSwap(pool, amountIn, label, { expectRevert = false } = {}) {
  const st = json(STATE_PATH);
  const zeroForOne = pool.key.currency0.toLowerCase() === st.stock2.toLowerCase();
  const args = [pool.key, zeroForOne, -BigInt(amountIn)];
  await ensureAllowance(st.stock2, EXECUTOR, BigInt(amountIn));
  const before = await publicClient.readContract({ address: pool.hook, abi: HOOK, functionName: 'getPolicy' });
  if (expectRevert) {
    let reason = '';
    try { await publicClient.simulateContract({ address: EXECUTOR, abi: ExecutorArtifact.abi, functionName: 'executeSwap', args, account }); }
    catch (e) { reason = decodeRevert(e); }
    if (!reason) throw new Error(`${label}: expected a revert but the pre-flight call succeeded`);
    const data = encodeFunctionData({ abi: ExecutorArtifact.abi, functionName: 'executeSwap', args });
    const hash = await walletClient.sendTransaction({ to: EXECUTOR, data, gas: 3_000_000n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'reverted') throw new Error(`${label}: expected a reverted tx, got ${receipt.status}`);
    const entry = { test: label, pool: pool.hook, phase: Number(before.phase), mode: Number(before.mode), tx: hash, block: Number(receipt.blockNumber), status: 'reverted', reason };
    record(entry); log(label, 'reverted as expected', hash); return entry;
  }
  const sent = await send({ address: EXECUTOR, abi: ExecutorArtifact.abi, functionName: 'executeSwap', args }, label);
  const after = await publicClient.readContract({ address: pool.hook, abi: HOOK, functionName: 'getPolicy' });
  const ev = parseEventLogs({ abi: ExecutorArtifact.abi, logs: sent.receipt.logs, eventName: 'RehearsalSwapExecuted' })[0];
  const entry = {
    test: label, pool: pool.hook, phase: Number(before.phase), phaseName: PHASE[before.phase], mode: Number(before.mode), canSwap: before.canSwap, lpFeeUnits: before.lpFeeUnits,
    tx: sent.hash, block: Number(sent.receipt.blockNumber), amount0: String(ev.args.amount0), amount1: String(ev.args.amount1),
    rollingRemainingBefore: before.rollingRemaining.map(String), rollingRemainingAfter: after.rollingRemaining.map(String),
  };
  record(entry); return entry;
}

async function waitUntil(label, predicate, { everyMs = 4000, maxMs = 3 * 3600 * 1000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await predicate();
    if (v) return v;
    if (Date.now() - t0 > maxMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(everyMs);
  }
}

// ───────────────────────────── drive ─────────────────────────────
async function drive() {
  const st = json(STATE_PATH);
  const pool = await rehearsalPool();
  const registry = MANIFEST.auctionRegistry;
  const auction = await publicClient.readContract({ address: registry, abi: AUCTION_REGISTRY, functionName: 'auctionFor', args: [pool.poolId] });
  if (auction === ZERO) throw new Error('the rehearsal pool has no auction');
  const a = (functionName, args = []) => publicClient.readContract({ address: auction, abi: AUCTION, functionName, args });
  const quote = MANIFEST.feeToken;
  const quoteDecimals = 6n;
  log('pool', pool.hook, 'auction', auction);

  // 1. Keeper: make the CLOSED leaf current, then arm the auction for the CLOSED to PRE transition.
  await waitUntil('first leaf', async () => (await chainNow()) >= Number(st.calendar.leaves[0].start));
  await advance();
  let armed = false;
  try { await send({ address: auction, abi: AUCTION, functionName: 'armNext', args: [] }, 'armNext'); armed = true; } catch (e) { log('armNext simulation:', decodeRevert(e)); }
  const cycle = await a('cycleId');
  const openTime = Number(await a('openTime'));
  const lead = Number(await a('auctionLead'));
  log(`auction cycle ${cycle} armed=${armed}; window opens at ${new Date((openTime - lead) * 1000).toISOString()}, PRE starts ${new Date(openTime * 1000).toISOString()}`);
  if (cycle === 0n) throw new Error('auction did not arm');

  // 2. A closed-market swap before the window opens is still allowed (it spends the closure budget).
  await directSwap(pool, 3n * 10n ** 17n, 'swap while CLOSED, before the auction window');

  // 3. When the window opens, ordinary swaps must be blocked and orders are accepted.
  await waitUntil('auction OPEN', async () => Number(await a('currentStage')) === 2);
  log('auction stage OPEN');
  await directSwap(pool, 3n * 10n ** 17n, 'swap during the auction window is blocked', { expectRevert: true });

  const minBase = await a('minOrderSizeBase');
  const minQuote = await a('minOrderSizeQuote');
  const Q96 = 2n ** 96n;
  const stockIsQuoteSide = false;
  // Prices are quote raw units per base raw unit, scaled by 2^96. The pool is seeded at 100 tUSDG per tNVDA.
  const px = (usdgPerStock) => (BigInt(usdgPerStock * 1e6) * Q96) / 10n ** 18n;
  const sellBase = 5n * 10n ** 18n;
  const buyQuote = 600n * 10n ** (quoteDecimals);
  if (sellBase < minBase || buyQuote < minQuote) throw new Error(`orders below the minimum (${minBase} base, ${minQuote} quote)`);
  await ensureAllowance(st.stock2, auction, sellBase);
  await ensureAllowance(quote, auction, buyQuote);
  const sell = await send({ address: auction, abi: AUCTION, functionName: 'submitOrder', args: [false, sellBase, px(99)] }, 'submit sell order: 5 tNVDA, limit 99');
  const buy = await send({ address: auction, abi: AUCTION, functionName: 'submitOrder', args: [true, buyQuote, px(101)] }, 'submit buy order: 600 tUSDG, limit 101');
  const sellId = parseEventLogs({ abi: AUCTION, logs: sell.receipt.logs, eventName: 'OrderSubmitted' })[0].args.orderId;
  const buyId = parseEventLogs({ abi: AUCTION, logs: buy.receipt.logs, eventName: 'OrderSubmitted' })[0].args.orderId;
  record({ test: 'auction orders submitted', pool: pool.hook, auction, cycle: Number(cycle), sellOrder: { id: sellId, tx: sell.hash }, buyOrder: { id: buyId, tx: buy.hash } });

  // 4. PRE starts: keeper advances the calendar, the book locks, anyone settles.
  await waitUntil('PRE start', async () => (await chainNow()) >= openTime);
  await advance();
  await waitUntil('auction LOCKED', async () => Number(await a('currentStage')) === 3);
  const preSummary = await a('cycleSummary', [cycle]);
  const settled = await send({ address: auction, abi: AUCTION, functionName: 'settle', args: [] }, 'settle (maximum-volume uniform price)');
  const summary = await a('cycleSummary', [cycle]);
  const allocSell = await a('allocation', [cycle, sellId]);
  const allocBuy = await a('allocation', [cycle, buyId]);
  const balBefore = [await publicClient.readContract({ address: st.stock2, abi: ERC20, functionName: 'balanceOf', args: [account.address] }), await publicClient.readContract({ address: quote, abi: ERC20, functionName: 'balanceOf', args: [account.address] })];
  const claimSell = await send({ address: auction, abi: AUCTION, functionName: 'claimUnfilled', args: [cycle, sellId] }, 'claim sell order');
  const claimBuy = await send({ address: auction, abi: AUCTION, functionName: 'claimUnfilled', args: [cycle, buyId] }, 'claim buy order');
  const balAfter = [await publicClient.readContract({ address: st.stock2, abi: ERC20, functionName: 'balanceOf', args: [account.address] }), await publicClient.readContract({ address: quote, abi: ERC20, functionName: 'balanceOf', args: [account.address] })];
  const entry = {
    test: 'opening auction full cycle', pool: pool.hook, auction, cycle: Number(cycle), openTime, settleTx: settled.hash, settleBlock: Number(settled.receipt.blockNumber),
    finalized: summary[5], clearingPriceX96: String(summary[3]), clearingPriceUsdgPerStock: Number(summary[3] * 10n ** 18n / Q96) / 1e6, matchedBase: String(summary[4]),
    stageBeforeSettle: STAGE[preSummary[2]], stageAfter: STAGE[summary[2]],
    allocationSell: { baseFill: String(allocSell[0]), quotePayout: String(allocSell[1]) },
    allocationBuy: { baseFill: String(allocBuy[0]), quoteRefund: String(allocBuy[2]) },
    claimTxs: [claimSell.hash, claimBuy.hash], netStockChange: String(balAfter[0] - balBefore[0]), netQuoteChange: String(balAfter[1] - balBefore[1]),
  };
  record(entry); log(JSON.stringify(entry));

  // 5. Session swaps: PRE now, then REGULAR once the calendar moves on.
  await directSwap(pool, 2n * 10n ** 17n, 'swap in the PRE session');
  const regular = st.calendar.leaves.find((l) => Number(l.phase) === 2);
  await waitUntil('REGULAR start', async () => (await chainNow()) >= Number(regular.start));
  await advance();
  await directSwap(pool, 2n * 10n ** 17n, 'swap in the REGULAR session');
  const closedAgain = st.calendar.leaves[st.calendar.leaves.length - 2];
  await waitUntil('CLOSED again', async () => (await chainNow()) >= Number(closedAgain.start));
  await advance();
  await directSwap(pool, 2n * 10n ** 17n, 'swap in CLOSED after the session');
  log('rehearsal timeline complete');
}

/**
 * Keeper step after the open. A pool whose closure latch is set stays in RECOVERING until the hook is checkpointed twice, at
 * least sixty seconds apart (REOPEN_MINIMUM_SEPARATION_SECONDS). Anyone may call `refreshState`; a keeper does it on a timer.
 */
async function recoverHook(pool) {
  for (let i = 0; i < 6; i++) {
    const policy = await publicClient.readContract({ address: pool.hook, abi: HOOK, functionName: 'getPolicy' });
    if (policy.canSwap) { log(`hook ${pool.hook} can swap (mode ${policy.mode}, phase ${PHASE[policy.phase]})`); return policy; }
    await send({ address: pool.hook, abi: HOOK_REFRESH, functionName: 'refreshState', args: [] }, `refreshState (mode ${policy.mode}, reasons ${policy.reasonBits})`);
    await sleep(65_000);
  }
  throw new Error('the hook did not recover');
}
const HOOK_REFRESH = parseAbi(['function refreshState()']);

/** Continue a run that stopped after the orders were submitted: recover, settle, claim, then the session swaps. */
async function resume() {
  const st = json(STATE_PATH);
  const pool = await rehearsalPool();
  const auction = pool.auction;
  const a = (functionName, args = []) => publicClient.readContract({ address: auction, abi: AUCTION, functionName, args });
  const quote = MANIFEST.feeToken;
  const orders = json(TESTS_PATH).entries.find((e) => e.test === 'auction orders submitted' && e.auction.toLowerCase() === auction.toLowerCase());
  if (!orders) throw new Error('no submitted orders recorded for this auction');
  const cycle = BigInt(orders.cycle); const sellId = Number(orders.sellOrder.id); const buyId = Number(orders.buyOrder.id);
  const Q96 = 2n ** 96n;

  const openTime = Number(await a('openTime'));
  await waitUntil('PRE start', async () => (await chainNow()) >= openTime);
  await advance();
  await waitUntil('auction LOCKED', async () => Number(await a('currentStage')) === 3);
  await recoverHook(pool);
  const preSummary = await a('cycleSummary', [cycle]);
  const settled = await send({ address: auction, abi: AUCTION, functionName: 'settle', args: [] }, 'settle (maximum-volume uniform price)');
  const summary = await a('cycleSummary', [cycle]);
  const allocSell = await a('allocation', [cycle, sellId]);
  const allocBuy = await a('allocation', [cycle, buyId]);
  const bal = async (t) => publicClient.readContract({ address: t, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  const before = [await bal(st.stock2), await bal(quote)];
  const claimSell = await send({ address: auction, abi: AUCTION, functionName: 'claimUnfilled', args: [cycle, sellId] }, 'claim sell order');
  const claimBuy = await send({ address: auction, abi: AUCTION, functionName: 'claimUnfilled', args: [cycle, buyId] }, 'claim buy order');
  const after = [await bal(st.stock2), await bal(quote)];
  const entry = {
    test: 'opening auction full cycle', pool: pool.hook, auction, cycle: Number(cycle), openTime, settleTx: settled.hash, settleBlock: Number(settled.receipt.blockNumber),
    finalized: summary[5], clearingPriceX96: String(summary[3]), clearingPriceUsdgPerStock: Number((summary[3] * 10n ** 18n) / Q96) / 1e6, matchedBase: String(summary[4]),
    stageBeforeSettle: STAGE[preSummary[2]], stageAfter: STAGE[summary[2]],
    allocationSell: { baseFill: String(allocSell[0]), quotePayout: String(allocSell[1]) },
    allocationBuy: { baseFill: String(allocBuy[0]), quoteRefund: String(allocBuy[2]) },
    claimTxs: [claimSell.hash, claimBuy.hash], netStockChange: String(after[0] - before[0]), netQuoteChange: String(after[1] - before[1]),
    keeperNote: 'the closure latch was released by two refreshState checkpoints sixty seconds apart before settle',
  };
  record(entry); log(JSON.stringify(entry));

  await directSwap(pool, 2n * 10n ** 17n, 'swap in the PRE session');
  const regular = st.calendar.leaves.find((l) => Number(l.phase) === 2);
  await waitUntil('REGULAR start', async () => (await chainNow()) >= Number(regular.start));
  await advance();
  await recoverHook(pool);
  await directSwap(pool, 2n * 10n ** 17n, 'swap in the REGULAR session');
  const closedAgain = st.calendar.leaves[st.calendar.leaves.length - 1];
  await waitUntil('CLOSED again', async () => (await chainNow()) >= Number(closedAgain.start));
  await advance();
  await directSwap(pool, 1n * 10n ** 17n, 'swap in CLOSED after the session');
  log('rehearsal timeline complete');
}


/**
 * After the compressed session closes there is no signed close anchor for the test asset, so the closed-market budget is not
 * available and BELL fails closed: a swap reverts with PolicyBlocked. An LP exit must still work. Both are recorded.
 */
async function closeout() {
  const st = json(STATE_PATH);
  const pool = await rehearsalPool();
  await advance();
  const policy = await publicClient.readContract({ address: pool.hook, abi: HOOK, functionName: 'getPolicy' });
  log('policy after the session:', JSON.stringify({ canSwap: policy.canSwap, mode: policy.mode, phase: PHASE[policy.phase] }));
  const swap = await directSwap(pool, 1n * 10n ** 17n, 'swap in CLOSED after the session fails closed (no close anchor)', { expectRevert: true });
  swap.errorName = 'PolicyBlocked(uint256)';

  const PM = MANIFEST.positionManager;
  const GET = ['function getPositionLiquidity(uint256) view returns (uint128)'];
  const tokenId = BigInt(pool.tokenId);
  const liquidity = await publicClient.readContract({ address: PM, abi: parseAbi(GET), functionName: 'getPositionLiquidity', args: [tokenId] });
  const part = liquidity / 10n;
  const actions = encodePacked(['uint8', 'uint8'], [0x01, 0x11]); // DECREASE_LIQUIDITY, TAKE_PAIR
  const p0 = encodeAbiParameters(parseAbiParameters('uint256, uint256, uint128, uint128, bytes'), [tokenId, part, 1n, 1n, '0x']);
  const p1 = encodeAbiParameters(parseAbiParameters('address, address, address'), [pool.key.currency0, pool.key.currency1, account.address]);
  const unlockData = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [actions, [p0, p1]]);
  const bal = (t) => publicClient.readContract({ address: t, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  const b = [await bal(pool.key.currency0), await bal(pool.key.currency1)];
  const head = await publicClient.getBlock();
  const sent = await send({ address: PM, abi: PositionManagerArtifact.abi, functionName: 'modifyLiquidities', args: [unlockData, BigInt(Number(head.timestamp) + 600)] }, 'withdraw 10 percent while swaps are blocked');
  const a = [await bal(pool.key.currency0), await bal(pool.key.currency1)];
  const left = await publicClient.readContract({ address: PM, abi: parseAbi(GET), functionName: 'getPositionLiquidity', args: [tokenId] });
  const entry = {
    test: 'withdraw while swaps are blocked (no close anchor)', pool: pool.hook, phase: Number(policy.phase), canSwap: policy.canSwap, mode: Number(policy.mode), tokenId: pool.tokenId,
    tx: sent.hash, block: Number(sent.receipt.blockNumber), liquidityBefore: String(liquidity), liquidityRemoved: String(part), liquidityAfter: String(left), received: [String(a[0] - b[0]), String(a[1] - b[1])],
  };
  record(entry); log(JSON.stringify(entry));
}

async function status() {
  const st = json(STATE_PATH);
  const now = await chainNow();
  const idx = st.calendar.leaves.findIndex((l) => Number(l.start) <= now && now < Number(l.end));
  console.log(JSON.stringify({ now: new Date(now * 1000).toISOString(), leaf: idx, phase: idx >= 0 ? PHASE[st.calendar.leaves[idx].phase] : null, leaves: st.calendar.leaves.map((l) => ({ phase: PHASE[l.phase], start: new Date(Number(l.start) * 1000).toISOString(), end: new Date(Number(l.end) * 1000).toISOString() })) }, null, 2));
}

const phases = { setup, advance, drive, resume, closeout, status };
const phase = process.argv[2];
if (!phases[phase]) { console.error(`usage: ${Object.keys(phases).join(' | ')}`); process.exit(2); }
await phases[phase]();
