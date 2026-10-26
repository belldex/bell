#!/usr/bin/env node
/**
 * Activate an AssetRegistry operation that was queued by queue-testnet-asset.mjs.
 *
 * queueAsset() opens a 48h timelock (GOVERNANCE_MINIMUM_DELAY_SECONDS = 172800) and the
 * operation then has a 7d window (GOVERNANCE_OPERATION_EXPIRY_SECONDS = 604800) before it
 * expires. Without activateAsset() the descriptor never lands in the registry, so
 * descriptorIdForToken() stays zero and BellPoolFactory rejects every create with
 * InvalidConfiguration. This is the missing half of the queue flow.
 *
 * Usage:
 *   node scripts/deploy/activate-testnet-asset.mjs --operation-id=0x.. [--token=0x..] [--eta=UNIX]
 *   node scripts/deploy/activate-testnet-asset.mjs --operation-id=0x.. --broadcast
 */
import { readFile } from 'node:fs/promises';
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  decodeEventLog,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  stringToHex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';

export const GOVERNANCE_MINIMUM_DELAY_SECONDS = 172800;
export const GOVERNANCE_OPERATION_EXPIRY_SECONDS = 604800;
export const EXPECTED_CHAIN_ID = 46630;

export const ASSET_QUEUED_EVENT = 'AssetQueued(bytes32 indexed operationId, bytes32 indexed descriptorId, uint64 eta)';

const REGISTRY_ABI = parseAbi([
  'function activateAsset(bytes32 operationId) returns (bytes32 descriptorId)',
  'function descriptorIdForToken(address token) view returns (bytes32)',
  'function descriptor(bytes32 descriptorId) view returns ((bytes32 id, address token, bool isStock, uint8 decimals, uint8 capabilityMask, address tokenPriceAdapter, address regularAdapter, address extendedAdapter, address overnightAdapter, address secondaryAdapter, bytes32 expectedCodeHash, bytes32 implementationFingerprint, bytes32 evidenceHash))',
  'function safetyController() view returns (address)'
]);

const SAFETY_ABI = parseAbi(['function governance() view returns (address)']);

const REVERT_ABI = parseAbi([
  'error Unauthorized()',
  'error BadConfig(bytes32 reason)',
  'error DeadlineExpired(uint64 deadline)'
]);

const REASON_TIMELOCK = keccak256(stringToHex('TIMELOCK'));
const REASON_ASSET_OPERATION = keccak256(stringToHex('ASSET_OPERATION'));
const REASON_ASSET_CHANGED = keccak256(stringToHex('ASSET_CHANGED'));

/** Pure: turn raw eth_getLogs entries into { operationId, descriptorId, eta }. */
export function parseAssetQueuedLogs(logs) {
  const out = [];
  for (const log of logs ?? []) {
    try {
      const decoded = decodeEventLog({
        abi: parseAbi([`event ${ASSET_QUEUED_EVENT}`]),
        data: log.data,
        topics: log.topics
      });
      out.push({
        operationId: decoded.args.operationId,
        descriptorId: decoded.args.descriptorId,
        eta: Number(decoded.args.eta),
        blockNumber: log.blockNumber == null ? null : Number(log.blockNumber)
      });
    } catch {
      // Not an AssetQueued log; ignore rather than fail the whole scan.
    }
  }
  return out;
}

/**
 * Pure: where the queued operation sits in its lifecycle.
 * ACTIVATED wins over every clock reading; the window is [eta, eta + expiry].
 */
export function describeQueueState({ eta, expiry, nowSeconds, activated = false }) {
  if (activated) return { state: 'ACTIVATED', secondsRemaining: 0 };
  if (!Number.isFinite(eta)) return { state: 'UNKNOWN', secondsRemaining: null };
  const end = Number.isFinite(expiry) ? expiry : eta + GOVERNANCE_OPERATION_EXPIRY_SECONDS;
  if (nowSeconds < eta) return { state: 'PENDING', secondsRemaining: eta - nowSeconds };
  if (nowSeconds > end) return { state: 'EXPIRED', secondsRemaining: 0 };
  return { state: 'READY', secondsRemaining: 0 };
}

/** Pure: map an activateAsset revert payload onto a human reason. */
export function classifyActivateRevert(data) {
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return 'UNKNOWN';
  try {
    const decoded = decodeErrorResult({ abi: REVERT_ABI, data });
    if (decoded.errorName === 'Unauthorized') return 'UNAUTHORIZED';
    if (decoded.errorName === 'DeadlineExpired') return 'EXPIRED';
    if (decoded.errorName === 'BadConfig') {
      const reason = decoded.args[0];
      if (reason === REASON_TIMELOCK) return 'TIMELOCK';
      if (reason === REASON_ASSET_OPERATION) return 'ALREADY_DONE_OR_CANCELLED';
      if (reason === REASON_ASSET_CHANGED) return 'TOKEN_CHANGED';
    }
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}

async function readEnv() {
  const env = {};
  try {
    const content = await readFile(new URL('../../.env', import.meta.url), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Fall through to process.env only.
  }
  return { ...env, ...process.env };
}

function argValue(args, name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

export async function activateAsset({
  operationId,
  token,
  eta,
  broadcast = false,
  rpcUrl,
  privateKey
}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(operationId ?? '')) throw new Error('operationId must be a 32-byte hex value');
  if (!rpcUrl) throw new Error('rpcUrl is required');

  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (chainId !== EXPECTED_CHAIN_ID) throw new Error(`Wrong chain: expected ${EXPECTED_CHAIN_ID}, got ${chainId}`);

  const registry = TESTNET.contracts.assetRegistry;
  const safety = await publicClient.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'safetyController' });
  const governance = await publicClient.readContract({ address: safety, abi: SAFETY_ABI, functionName: 'governance' });

  const alreadyActive = token
    ? await publicClient.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'descriptorIdForToken', args: [token] })
    : undefined;

  const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'activateAsset', args: [operationId] });

  let simulation;
  try {
    const result = await publicClient.call({ account: governance, to: registry, data });
    simulation = { ok: true, descriptorId: result.data };
  } catch (error) {
    const payload = error?.cause?.data ?? error?.data ?? error?.cause?.cause?.data;
    simulation = { ok: false, reason: classifyActivateRevert(payload) };
  }

  const nowSeconds = Number(await publicClient.getBlock({ blockTag: 'latest' }).then((b) => b.timestamp));
  const lifecycle = describeQueueState({
    eta: eta === undefined ? NaN : Number(eta),
    expiry: eta === undefined ? NaN : Number(eta) + GOVERNANCE_OPERATION_EXPIRY_SECONDS,
    nowSeconds,
    activated: Boolean(alreadyActive && alreadyActive !== `0x${'0'.repeat(64)}`)
  });

  const preview = {
    chainId,
    registry,
    governance,
    operationId,
    token: token ?? null,
    eta: eta === undefined ? null : Number(eta),
    nowSeconds,
    lifecycle,
    simulated: simulation,
    alreadyActive: alreadyActive ?? null
  };

  if (!broadcast) return { ...preview, broadcast: false };
  if (!simulation.ok) throw new Error(`activateAsset would revert: ${simulation.reason}`);
  if (!privateKey) throw new Error('privateKey is required for broadcast');

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  if (account.address.toLowerCase() !== governance.toLowerCase()) {
    throw new Error(`Signer ${account.address} is not governance ${governance}`);
  }

  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  const hash = await wallet.sendTransaction({ to: registry, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`activation reverted in tx ${hash}`);

  let verification = null;
  if (token) {
    const descriptorId = await publicClient.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: 'descriptorIdForToken',
      args: [token]
    });
    const descriptor = await publicClient.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: 'descriptor',
      args: [descriptorId]
    });
    verification = {
      descriptorId,
      token: descriptor.token,
      isStock: descriptor.isStock,
      decimals: descriptor.decimals,
      evidenceHash: descriptor.evidenceHash,
      implementationFingerprint: descriptor.implementationFingerprint,
      tokenMatches: descriptor.token.toLowerCase() === token.toLowerCase(),
      bound: descriptorId !== `0x${'0'.repeat(64)}`
    };
    if (!verification.bound || !verification.tokenMatches) {
      throw new Error('activation succeeded but the registry does not resolve the token');
    }
  }

  return { ...preview, broadcast: true, txHash: hash, blockNumber: Number(receipt.blockNumber), verification };
}

async function runCli() {
  const args = process.argv.slice(2);
  const env = await readEnv();
  const operationId = argValue(args, 'operation-id');
  if (!operationId) {
    console.error('Usage: node scripts/deploy/activate-testnet-asset.mjs --operation-id=0x.. [--token=0x..] [--eta=UNIX] [--broadcast]');
    process.exit(1);
  }
  const token = argValue(args, 'token');
  const eta = argValue(args, 'eta');
  const broadcast = args.includes('--broadcast');
  const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
  const privateKey = env.RH_TESTNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;

  console.log(`=== AssetRegistry Activation: ${operationId} ===`);
  console.log(`Mode: ${broadcast ? 'BROADCAST' : 'PREVIEW (simulated eth_call)'}`);

  const result = await activateAsset({
    operationId,
    token,
    eta: eta === undefined ? undefined : Number(eta),
    broadcast,
    rpcUrl,
    privateKey
  });

  console.log(`- Registry:   ${result.registry}`);
  console.log(`- Governance: ${result.governance}`);
  console.log(`- Lifecycle:  ${result.lifecycle.state}${result.lifecycle.secondsRemaining ? ` (in ${formatDuration(result.lifecycle.secondsRemaining)})` : ''}`);
  console.log(`- Simulated:  ${result.simulated.ok ? 'would succeed' : `would revert: ${result.simulated.reason}`}`);
  if (result.broadcast) {
    console.log(`- Tx:         ${result.txHash} (block ${result.blockNumber})`);
    if (result.verification) console.log(`- Descriptor: ${result.verification.descriptorId} bound=${result.verification.bound}`);
  } else if (result.simulated.ok) {
    console.log('- Run with --broadcast to submit.');
  }
}

if (process.argv[1] && process.argv[1].endsWith('activate-testnet-asset.mjs')) {
  runCli().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
