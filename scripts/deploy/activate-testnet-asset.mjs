import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  decodeErrorResult,
  decodeEventLog,
  keccak256,
  parseAbi,
  stringToHex,
  createPublicClient,
  createWalletClient,
  http
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';

export const ASSET_QUEUED_EVENT = 'AssetQueued(bytes32 indexed operationId,bytes32 indexed descriptorId,uint64 eta)';
export const GOVERNANCE_OPERATION_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

const EVENT_ABI = parseAbi([`event ${ASSET_QUEUED_EVENT}`]);
const ERROR_ABI = parseAbi([
  'error Unauthorized()',
  'error BadConfig(bytes32 reason)',
  'error DeadlineExpired(uint64 deadline)',
]);
const BAD_CONFIG_REASONS = new Map([
  ['TIMELOCK', 'TIMELOCK'],
  ['ASSET_OPERATION', 'ALREADY_DONE_OR_CANCELLED'],
  ['ASSET_CHANGED', 'TOKEN_CHANGED'],
]);

export function parseAssetQueuedLogs(logs) {
  const parsed = [];
  for (const log of logs ?? []) {
    try {
      const event = decodeEventLog({ abi: EVENT_ABI, ...log, strict: true });
      if (event.eventName !== 'AssetQueued') continue;
      parsed.push({
        operationId: event.args.operationId,
        descriptorId: event.args.descriptorId,
        eta: event.args.eta,
        blockNumber: log.blockNumber,
      });
    } catch {
      // Ignore unrelated or malformed logs; only canonical AssetQueued logs are relevant.
    }
  }
  return parsed;
}

export function describeQueueState({ eta, expiry, nowSeconds, activated = false } = {}) {
  if (activated) return { state: 'ACTIVATED' };
  if (![eta, nowSeconds].every(Number.isFinite) || (expiry !== undefined && !Number.isFinite(expiry))) {
    return { state: 'UNKNOWN' };
  }
  if (expiry !== undefined && nowSeconds > expiry) return { state: 'EXPIRED' };
  if (nowSeconds < eta) return { state: 'PENDING', secondsRemaining: eta - nowSeconds };
  return { state: 'READY' };
}

export function classifyActivateRevert(data) {
  if (typeof data !== 'string' || !/^0x[0-9a-f]+$/i.test(data)) return 'UNKNOWN';
  try {
    const decoded = decodeErrorResult({ abi: ERROR_ABI, data });
    if (decoded.errorName === 'Unauthorized') return 'UNAUTHORIZED';
    if (decoded.errorName === 'DeadlineExpired') return 'EXPIRED';
    if (decoded.errorName === 'BadConfig') {
      const reason = `0x${decoded.args[0].slice(2, 66)}`.toLowerCase();
      for (const [label, result] of BAD_CONFIG_REASONS) {
        // Solidity uses keccak256(reason string) as the bytes32 error code.
        if (reason === reasonHash(label)) return result;
      }
    }
  } catch {
    // Unknown selector or malformed revert payload.
  }
  return 'UNKNOWN';
}

function reasonHash(value) {
  return keccak256(stringToHex(value));
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown';
  if (seconds === 0) return '0s';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d${hours ? ` ${hours}h` : ''}${minutes ? ` ${minutes}m` : ''}`;
  if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
  return `${minutes}m`;
}

const ASSET_REGISTRY_ABI = parseAbi([
  'function activateAsset(bytes32 operationId) external returns (bytes32)',
  'function operation(bytes32 operationId) view returns (uint8, bytes32, uint64, uint64, uint8)',
  'function descriptorIdForToken(address token) view returns (bytes32)',
]);

async function main() {
  const opId = process.argv[2] || '0xde628510a905281a75190305f45126874659f5c7da5a3b0d72e2ac4c79a26c72';
  const envContent = await readFile('.env', 'utf8');
  const env = {};
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
  const privateKey = env.RH_TESTNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

  console.log(`=== Activating Asset Operation: ${opId} ===`);
  const op = await publicClient.readContract({
    address: TESTNET.contracts.assetRegistry,
    abi: ASSET_REGISTRY_ABI,
    functionName: 'operation',
    args: [opId]
  });
  console.log(`Status: ${op[4]} (1=QUEUED, 2=DONE, 3=CANCELLED)`);
  console.log(`ETA:    ${op[2]}`);

  const block = await publicClient.getBlock();
  console.log(`Current Block Timestamp: ${block.timestamp}`);

  if (block.timestamp < op[2]) {
    console.log(`TIMELOCK PENDING: Need to wait ${op[2] - block.timestamp}s`);
    return;
  }

  console.log('Sending activateAsset transaction...');
  const hash = await walletClient.writeContract({
    address: TESTNET.contracts.assetRegistry,
    abi: ASSET_REGISTRY_ABI,
    functionName: 'activateAsset',
    args: [opId]
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Activation confirmed in block ${receipt.blockNumber} (tx: ${hash})`);

  const descId = await publicClient.readContract({
    address: TESTNET.contracts.assetRegistry,
    abi: ASSET_REGISTRY_ABI,
    functionName: 'descriptorIdForToken',
    args: [TESTNET.contracts.weth]
  });
  console.log(`WETH Descriptor ID: ${descId}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
