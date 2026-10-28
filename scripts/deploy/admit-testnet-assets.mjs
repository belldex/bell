#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeSourceWires } from '../../packages/protocol/src/source-codec.mjs';

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
if (!rpcUrl || !deployerPk) throw new Error('Missing RPC or deployer PK');

const stockAdapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const { stockToken, directAdapter, regularAdapter, extendedAdapter, directWire, regularWire, extendedWire } = stockAdapters;

const account = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const registryAddress = MANIFEST.assetRegistry;
const wethAddress = MANIFEST.weth;

console.log('Registry Address:', registryAddress);
console.log('WETH Address:    ', wethAddress);
console.log('StockToken:      ', stockToken);

const REGISTRY_ABI = parseAbi([
  'function queueAsset((bytes32 id, address token, bool isStock, uint8 decimals, uint8 capabilityMask, address tokenPriceAdapter, address regularAdapter, address extendedAdapter, address overnightAdapter, address secondaryAdapter, bytes32 expectedCodeHash, bytes32 implementationFingerprint, bytes32 evidenceHash) descriptor, bytes sourceConfig) external returns (bytes32)',
  'function activateAsset(bytes32 operationId) external returns (bytes32)',
  'function descriptorIdForToken(address token) view returns (bytes32)',
  'function descriptor(bytes32 id) view returns ((bytes32 id, address token, bool isStock, uint8 decimals, uint8 capabilityMask, address tokenPriceAdapter, address regularAdapter, address extendedAdapter, address overnightAdapter, address secondaryAdapter, bytes32 expectedCodeHash, bytes32 implementationFingerprint, bytes32 evidenceHash))',
]);

const ERC20_ABI = parseAbi([
  'function decimals() view returns (uint8)',
]);

async function admitAsset({ token, isStock, capabilityMask, tokenPriceAdapter, regularAdapter, extendedAdapter, sourceConfig }) {
  const currentId = await publicClient.readContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'descriptorIdForToken',
    args: [token],
  });
  if (currentId !== '0x' + '0'.repeat(64)) {
    console.log(`Token ${token} already active with ID ${currentId}`);
    return currentId;
  }

  const code = await publicClient.getBytecode({ address: token });
  const codeHash = keccak256(code);
  const decimals = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'decimals',
  });

  const descriptor = {
    id: '0x' + '0'.repeat(64),
    token,
    isStock,
    decimals,
    capabilityMask,
    tokenPriceAdapter: tokenPriceAdapter || '0x0000000000000000000000000000000000000000',
    regularAdapter: regularAdapter || '0x0000000000000000000000000000000000000000',
    extendedAdapter: extendedAdapter || '0x0000000000000000000000000000000000000000',
    overnightAdapter: '0x0000000000000000000000000000000000000000',
    secondaryAdapter: '0x0000000000000000000000000000000000000000',
    expectedCodeHash: codeHash,
    implementationFingerprint: keccak256(stringToHex(`impl:${token}`)),
    evidenceHash: keccak256(stringToHex(`evidence:${token}`)),
  };

  console.log(`\nQueueing asset for ${token}...`);
  const queueTx = await walletClient.writeContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'queueAsset',
    args: [descriptor, sourceConfig || '0x'],
  });
  const queueReceipt = await publicClient.waitForTransactionReceipt({ hash: queueTx });
  console.log('Queue TX:', queueTx, 'block:', queueReceipt.blockNumber.toString());

  // Extract operationId from OperationQueued event or simulate
  // Log event signature for OperationQueued(bytes32 indexed operationId, ...)
  const opId = queueReceipt.logs[0].topics[1];
  console.log('Operation ID:', opId);

  // Activate (zero delay on chain 46630)
  console.log(`Activating asset with opId ${opId}...`);
  const activateTx = await walletClient.writeContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'activateAsset',
    args: [opId],
  });
  const activateReceipt = await publicClient.waitForTransactionReceipt({ hash: activateTx });
  console.log('Activate TX:', activateTx, 'block:', activateReceipt.blockNumber.toString());

  const descriptorId = await publicClient.readContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'descriptorIdForToken',
    args: [token],
  });
  console.log(`Active Descriptor ID for ${token}:`, descriptorId);
  return descriptorId;
}

// 1. Admit WETH counterasset
console.log('=== Step 1: Admit WETH Counterasset ===');
const wethDescriptorId = await admitAsset({
  token: wethAddress,
  isStock: false,
  capabilityMask: 0,
  sourceConfig: '0x',
});

// 2. Admit StockToken
console.log('\n=== Step 2: Admit StockToken ===');
const wires = [directWire, regularWire, extendedWire];
const encodedSourceConfig = encodeSourceWires(wires);

const stockDescriptorId = await admitAsset({
  token: stockToken,
  isStock: true,
  capabilityMask: 0x06, // PRE (2) + REGULAR (4) = 6 = 0x06
  tokenPriceAdapter: directAdapter,
  regularAdapter: regularAdapter,
  extendedAdapter: extendedAdapter,
  sourceConfig: encodedSourceConfig,
});

const queueEvidence = {
  weth: {
    token: wethAddress,
    descriptorId: wethDescriptorId,
    isStock: false,
  },
  stock: {
    token: stockToken,
    descriptorId: stockDescriptorId,
    isStock: true,
    directAdapter,
    regularAdapter,
    extendedAdapter,
  },
  registryAddress,
  chainId: 46630,
  admittedAt: new Date().toISOString(),
};

writeFileSync('evidence/deploy/testnet-46630-asset-queue.json', JSON.stringify(queueEvidence, null, 2) + '\n');
console.log('\nSaved admission evidence to evidence/deploy/testnet-46630-asset-queue.json');
