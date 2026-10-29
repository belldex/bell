#!/usr/bin/env node
/**
 * Mainnet asset admission: queue, wait 48h, activate.
 *
 * On testnet (46630) `AssetRegistry.queueAsset` stamps eta = now, so admission is one script that
 * queues and activates back to back. On mainnet the same call stamps eta = now + 48h, and
 * `activateAsset` reverts with `ERR_TIMELOCK` until then. A single script that assumes otherwise
 * fails halfway through and leaves a pending operation behind, so this one is staged and resumable:
 *
 *   node scripts/deploy/mainnet-admit-assets.mjs status
 *   node scripts/deploy/mainnet-admit-assets.mjs queue
 *   node scripts/deploy/mainnet-admit-assets.mjs activate
 *
 * It refuses to admit a testnet fixture token, a token whose code hash it cannot pin, or a stock
 * descriptor without the adapters the registry requires.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, parseAbi, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeSourceWires } from '../../packages/protocol/src/source-codec.mjs';
import { canonicalTokenId } from '../../packages/protocol/src/identity.mjs';
import { planGovernanceOperation } from '../calendar/mainnet-timeline.mjs';

const MAINNET_CHAIN_ID = 4663;
const ZERO32 = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const STATE_PATH = 'evidence/deploy/mainnet-4663-asset-state.json';
const QUEUE_PATH = 'evidence/deploy/mainnet-4663-asset-queue.json';

const REGISTRY_ABI = parseAbi([
  'function queueAsset((bytes32 id, address token, bool isStock, uint8 decimals, uint8 capabilityMask, address tokenPriceAdapter, address regularAdapter, address extendedAdapter, address overnightAdapter, address secondaryAdapter, bytes32 expectedCodeHash, bytes32 implementationFingerprint, bytes32 evidenceHash) descriptor, bytes sourceConfig) external returns (bytes32)',
  'function activateAsset(bytes32 operationId) external returns (bytes32)',
  'function descriptorIdForToken(address token) view returns (bytes32)',
  'function operation(bytes32 operationId) view returns (uint8 kind, bytes32 payloadHash, uint64 eta, uint64 expiry, uint8 status)',
  'event AssetQueued(bytes32 indexed operationId, bytes32 indexed descriptorId, uint64 eta)',
]);

const ERC20_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

const STATUS = { 1: 'QUEUED', 2: 'DONE', 3: 'CANCELLED' };

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
const pk = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl) throw new Error('RH_MAINNET_RPC_PRIMARY is required');
if (!pk) throw new Error('RH_MAINNET_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required');

const manifest = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
if (Number(manifest.chainId) !== MAINNET_CHAIN_ID) {
  throw new Error(`manifest chainId is ${manifest.chainId}, expected ${MAINNET_CHAIN_ID}`);
}
const registryAddress = manifest.assetRegistry;
const wethAddress = manifest.weth;

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Wrong chain ${chainId}; expected ${MAINNET_CHAIN_ID}`);

const head = await publicClient.getBlock();
const now = Number(head.timestamp);

function readJson(path, fallback = null) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

async function simulateAndSend(request, label) {
  await publicClient.simulateContract({ ...request, account });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label} mined: ${hash} block ${receipt.blockNumber}`);
  return { hash, receipt };
}

/** Reject anything that is obviously a rehearsal artefact before it reaches mainnet. */
function assertNotRehearsalToken({ token, symbol, label }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(token ?? '') || token.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label}: token address is missing or malformed`);
  }
  if (/facade|testnet|rehearsal|fixture|mock/i.test(symbol ?? '')) {
    throw new Error(`${label}: token symbol "${symbol}" looks like a rehearsal fixture, not a mainnet asset`);
  }
  const configured = JSON.parse(readFileSync('config/assets/candidates.mainnet.json', 'utf8'));
  const known = configured.assets?.find((a) => a.token.toLowerCase() === token.toLowerCase());
  if (!known) {
    throw new Error(`${label}: token ${token} is not in config/assets/candidates.mainnet.json; add reviewed evidence first`);
  }
  return known;
}

async function describeToken(token) {
  const [code, decimals, symbol] = await Promise.all([
    publicClient.getBytecode({ address: token }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => null),
  ]);
  if (!code || code === '0x') throw new Error(`no code at ${token}`);
  return { codeHash: keccak256(code), decimals: Number(decimals), symbol };
}

async function queueAsset({ label, token, isStock, capabilityMask, adapters, sourceConfig, evidenceHash }) {
  const existingId = await publicClient.readContract({
    address: registryAddress, abi: REGISTRY_ABI, functionName: 'descriptorIdForToken', args: [token],
  });
  if (existingId !== ZERO32) {
    console.log(`${label}: already active with descriptor ${existingId}`);
    return { descriptorId: existingId, alreadyActive: true };
  }

  const info = await describeToken(token);
  if (isStock) assertNotRehearsalToken({ token, symbol: info.symbol, label });

  const descriptor = {
    id: ZERO32,
    token,
    isStock,
    decimals: info.decimals,
    capabilityMask,
    tokenPriceAdapter: adapters.tokenPrice ?? ZERO_ADDRESS,
    regularAdapter: adapters.regular ?? ZERO_ADDRESS,
    extendedAdapter: adapters.extended ?? ZERO_ADDRESS,
    overnightAdapter: adapters.overnight ?? ZERO_ADDRESS,
    secondaryAdapter: ZERO_ADDRESS,
    expectedCodeHash: info.codeHash,
    implementationFingerprint: keccak256(stringToHex(`impl:${token}:${info.codeHash}`)),
    evidenceHash: evidenceHash ?? keccak256(stringToHex(`evidence:${token}:${info.codeHash}`)),
  };

  const { hash, receipt } = await simulateAndSend({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'queueAsset',
    args: [descriptor, sourceConfig ?? '0x'],
  }, `queueAsset(${label})`);

  const events = parseEventLogs({ abi: REGISTRY_ABI, logs: receipt.logs, eventName: 'AssetQueued' });
  const queued = events[0]?.args;
  if (!queued) throw new Error(`${label}: AssetQueued event missing from receipt`);
  console.log(`${label}: operation ${queued.operationId} ETA ${new Date(Number(queued.eta) * 1000).toISOString()}`);
  return {
    descriptorId: queued.descriptorId,
    operationId: queued.operationId,
    eta: Number(queued.eta),
    txHash: hash,
    alreadyActive: false,
  };
}

const command = process.argv[2] ?? 'status';

if (command === 'status') {
  const state = readJson(STATE_PATH);
  const wethId = await publicClient.readContract({
    address: registryAddress, abi: REGISTRY_ABI, functionName: 'descriptorIdForToken', args: [wethAddress],
  });
  const out = { chainId, chainTime: now, chainTimeIso: new Date(now * 1000).toISOString(), registryAddress, wethDescriptorId: wethId, state };
  for (const key of ['weth', 'stock']) {
    const operationId = state?.[key]?.operationId;
    if (!operationId) continue;
    const op = await publicClient.readContract({
      address: registryAddress, abi: REGISTRY_ABI, functionName: 'operation', args: [operationId],
    });
    const [, , eta, expiry, status] = op;
    out[`${key}Operation`] = {
      status: STATUS[Number(status)] ?? Number(status),
      eta: Number(eta),
      etaIso: new Date(Number(eta) * 1000).toISOString(),
      expiry: Number(expiry),
      expiryIso: new Date(Number(expiry) * 1000).toISOString(),
      executableNow: now >= Number(eta) && now <= Number(expiry),
    };
  }
  console.log(JSON.stringify(out, null, 2));
} else if (command === 'queue') {
  const adapters = readJson('evidence/deploy/mainnet-4663-stock-adapters.json');
  if (!adapters) {
    throw new Error('evidence/deploy/mainnet-4663-stock-adapters.json is required; deploy the verifier and adapters first');
  }
  const state = readJson(STATE_PATH) ?? { chainId, registryAddress };

  console.log('=== WETH counterasset ===');
  const weth = state.weth?.operationId || state.weth?.alreadyActive
    ? state.weth
    : await queueAsset({ label: 'WETH', token: wethAddress, isStock: false, capabilityMask: 0, adapters: {} });

  console.log('\n=== Stock asset ===');
  const stock = state.stock?.operationId
    ? state.stock
    : await queueAsset({
      label: adapters.symbol ?? 'STOCK',
      token: adapters.stockToken,
      isStock: true,
      capabilityMask: Number(process.env.BELL_CAPABILITY_MASK || adapters.capabilityMask || 0b110),
      adapters: {
        tokenPrice: adapters.directAdapter,
        regular: adapters.regularAdapter,
        extended: adapters.extendedAdapter,
        overnight: adapters.overnightAdapter,
      },
      sourceConfig: encodeSourceWires([adapters.directWire, adapters.regularWire, adapters.extendedWire].filter(Boolean)),
    });

  const pendingEtas = [weth.eta, stock.eta].filter((value) => Number.isSafeInteger(value));
  const eta = pendingEtas.length ? Math.max(...pendingEtas) : now;
  const next = {
    ...state,
    chainId,
    registryAddress,
    weth: { ...weth, token: wethAddress },
    stock: { ...stock, token: adapters.stockToken },
    queuedAt: now,
    eta,
    expiry: eta + 7 * 86_400,
  };
  writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  writeFileSync(QUEUE_PATH, `${JSON.stringify({
    weth: { token: wethAddress, descriptorId: weth.descriptorId, isStock: false },
    stock: {
      token: adapters.stockToken,
      descriptorId: stock.descriptorId,
      isStock: true,
      directAdapter: adapters.directAdapter,
      regularAdapter: adapters.regularAdapter,
      extendedAdapter: adapters.extendedAdapter,
    },
    registryAddress,
    chainId,
    admittedAt: new Date().toISOString(),
    activationPending: true,
  }, null, 2)}\n`);
  console.log(`\nQueued. Activate at or after ${new Date(next.eta * 1000).toISOString()}.`);
  console.log(`Both WETH and the stock asset must be activated; WETH is not oracleless-exempt from the delay.`);
} else if (command === 'activate') {
  const state = readJson(STATE_PATH);
  if (!state) throw new Error('no asset state; run `queue` first');

  // Both operations were queued in the same block, so they share an ETA. Activate each one that
  // is still pending, in order, and stop on the first genuine failure.
  for (const key of ['weth', 'stock']) {
    const entry = state[key];
    if (!entry?.operationId) {
      if (entry?.alreadyActive || entry?.descriptorId) {
        console.log(`${key}: already active, nothing to activate`);
        continue;
      }
      throw new Error(`${key}: no queued operation recorded; run \`queue\` first`);
    }

    const op = await publicClient.readContract({
      address: registryAddress, abi: REGISTRY_ABI, functionName: 'operation', args: [entry.operationId],
    });
    const [, , eta, expiry, status] = op;
    if (Number(status) === 2) {
      console.log(`${key}: already DONE on chain`);
      continue;
    }
    if (Number(status) !== 1) throw new Error(`${key}: operation status is ${STATUS[Number(status)] ?? status}, not QUEUED`);

    const described = planGovernanceOperation({ now: Number(eta) - 172_800 }).describe(now);
    if (described.state === 'WAITING') {
      console.error(`${key}: too early by ${described.secondsRemaining}s; ETA is ${new Date(Number(eta) * 1000).toISOString()}`);
      process.exit(1);
    }
    if (described.state === 'EXPIRED') {
      console.error(`${key}: the operation expired at ${new Date(Number(expiry) * 1000).toISOString()}`);
      process.exit(1);
    }

    await simulateAndSend({
      address: registryAddress, abi: REGISTRY_ABI, functionName: 'activateAsset', args: [entry.operationId],
    }, `activateAsset(${key})`);

    const descriptorId = await publicClient.readContract({
      address: registryAddress, abi: REGISTRY_ABI, functionName: 'descriptorIdForToken', args: [entry.token],
    });
    state[key] = { ...entry, descriptorId, active: true };
    console.log(`${key}: descriptor active ${descriptorId}`);
  }

  const queue = readJson(QUEUE_PATH);
  queue.weth.descriptorId = state.weth.descriptorId;
  queue.stock.descriptorId = state.stock.descriptorId;
  queue.activationPending = false;
  queue.activatedAt = new Date().toISOString();
  writeFileSync(QUEUE_PATH, `${JSON.stringify(queue, null, 2)}\n`);
  writeFileSync(STATE_PATH, `${JSON.stringify({ ...state, stage: 'ACTIVE', activatedAt: now }, null, 2)}\n`);
  console.log('Both descriptors are ACTIVE on mainnet.');
} else {
  console.error(`Unknown command "${command}". Use status | queue | activate`);
  process.exit(1);
}
