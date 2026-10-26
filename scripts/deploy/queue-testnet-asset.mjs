import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  encodeFunctionData,
  decodeFunctionResult,
  parseAbi,
  keccak256,
  stringToHex,
  encodeAbiParameters,
  parseAbiParameters,
  createPublicClient,
  createWalletClient,
  http
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';

const ASSET_REGISTRY_ABI = parseAbi([
  'function queueAsset((bytes32 id, address token, bool isStock, uint8 decimals, uint8 capabilityMask, address tokenPriceAdapter, address regularAdapter, address extendedAdapter, address overnightAdapter, address secondaryAdapter, bytes32 expectedCodeHash, bytes32 implementationFingerprint, bytes32 evidenceHash) descriptor, bytes sourceConfig) external returns (bytes32)',
  'function safetyController() view returns (address)',
  'function descriptorIdForToken(address) view returns (bytes32)',
]);

const SAFETY_CONTROLLER_ABI = parseAbi([
  'function governance() view returns (address)',
]);

const ERC20_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
]);

export async function previewOrQueueAsset({
  tokenAddress,
  isStock = false,
  capabilityMask = 0,
  tokenPriceAdapter = '0x0000000000000000000000000000000000000000',
  regularAdapter = '0x0000000000000000000000000000000000000000',
  extendedAdapter = '0x0000000000000000000000000000000000000000',
  overnightAdapter = '0x0000000000000000000000000000000000000000',
  secondaryAdapter = '0x0000000000000000000000000000000000000000',
  implementationFingerprint = '0x0000000000000000000000000000000000000000000000000000000000000001',
  evidenceHash = null,
  sourceConfig = '0x',
  broadcast = false,
  rpcUrl,
  privateKey,
}) {
  if (!rpcUrl) throw new Error('rpcUrl is required');
  const publicClient = createPublicClient({ transport: http(rpcUrl) });

  const chainId = await publicClient.getChainId();
  if (chainId !== TESTNET.chainId) {
    throw new Error(`Wrong chain: expected ${TESTNET.chainId}, got ${chainId}`);
  }

  // 1. Fetch token code and decimals
  const code = await publicClient.getBytecode({ address: tokenAddress });
  if (!code || code === '0x') {
    throw new Error(`Token ${tokenAddress} has no bytecode on chain ${chainId}`);
  }
  const tokenCodeHash = keccak256(code);
  const decimals = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
  });

  const effEvidenceHash = evidenceHash || keccak256(stringToHex(`rehearsal-evidence:${tokenAddress}`));

  const descriptor = {
    id: '0x0000000000000000000000000000000000000000000000000000000000000000',
    token: tokenAddress,
    isStock,
    decimals,
    capabilityMask,
    tokenPriceAdapter,
    regularAdapter,
    extendedAdapter,
    overnightAdapter,
    secondaryAdapter,
    expectedCodeHash: tokenCodeHash,
    implementationFingerprint,
    evidenceHash: effEvidenceHash,
  };

  const registryAddress = TESTNET.contracts.assetRegistry;

  // Check governance address
  const safetyAddress = await publicClient.readContract({
    address: registryAddress,
    abi: ASSET_REGISTRY_ABI,
    functionName: 'safetyController',
  });
  const governance = await publicClient.readContract({
    address: safetyAddress,
    abi: SAFETY_CONTROLLER_ABI,
    functionName: 'governance',
  });

  // Simulate queueAsset call via eth_call
  const callData = encodeFunctionData({
    abi: ASSET_REGISTRY_ABI,
    functionName: 'queueAsset',
    args: [descriptor, sourceConfig],
  });

  const simResult = await publicClient.call({
    account: governance,
    to: registryAddress,
    data: callData,
  });

  const operationId = decodeFunctionResult({
    abi: ASSET_REGISTRY_ABI,
    functionName: 'queueAsset',
    data: simResult.data,
  });

  const preview = {
    chainId,
    registryAddress,
    governance,
    tokenAddress,
    decimals,
    tokenCodeHash,
    descriptor,
    operationId,
    simulatedSuccess: true,
  };

  if (!broadcast) {
    return { ...preview, broadcast: false };
  }

  if (!privateKey) {
    throw new Error('privateKey is required for broadcast');
  }

  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  if (account.address.toLowerCase() !== governance.toLowerCase()) {
    throw new Error(`Signer ${account.address} is not the governance address ${governance}`);
  }

  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  const hash = await walletClient.sendTransaction({
    to: registryAddress,
    data: callData,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return {
    ...preview,
    broadcast: true,
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    status: receipt.status,
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const isBroadcast = args.includes('--broadcast');
  const tokenArg = args.find(a => a.startsWith('--token='))?.slice(8) || TESTNET.contracts.weth;

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

  console.log(`=== AssetRegistry Governance Queue: ${tokenArg} ===`);
  console.log(`Mode: ${isBroadcast ? 'BROADCAST' : 'PREVIEW (simulated eth_call)'}`);

  const result = await previewOrQueueAsset({
    tokenAddress: tokenArg,
    isStock: false,
    broadcast: isBroadcast,
    rpcUrl,
    privateKey,
  });

  console.log('Result:');
  console.log(`- Token:        ${result.tokenAddress} (Decimals: ${result.decimals})`);
  console.log(`- Governance:   ${result.governance}`);
  console.log(`- Operation ID: ${result.operationId}`);
  if (result.broadcast) {
    console.log(`- Tx Hash:      ${result.txHash}`);
    console.log(`- Block:        ${result.blockNumber}`);
    console.log(`- Status:       ${result.status}`);
  } else {
    console.log('- Preview successful! Run with --broadcast to sign and submit.');
  }
}

if (process.argv[1]?.endsWith('queue-testnet-asset.mjs')) {
  runCli().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
