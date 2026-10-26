import { readFile } from 'node:fs/promises';
import {
  parseAbi,
  createPublicClient,
  createWalletClient,
  http
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';

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

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
