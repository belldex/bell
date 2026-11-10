import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, encodeDeployData, formatEther, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadEnvFile } from './env-loader.mjs';

process.on('uncaughtException', (error) => { console.error('Deployment stopped:', error?.shortMessage ?? error?.message ?? 'unknown error'); process.exit(1); });
if (!process.argv.includes('--broadcast')) throw new Error('Pass --broadcast to submit Mainnet deployment transactions');
const env = loadEnvFile();
const key = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
const rpc = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY;
if (!key || !rpc) throw new Error('Mainnet deployer key or RPC missing');
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const client = createPublicClient({ transport: http(rpc, { timeout: 30000 }) });
const wallet = createWalletClient({ account, transport: http(rpc, { timeout: 30000 }) });
const expected = '0x6c3659988bd5f9e94f927b3fd7d0ee3746f8d399';
if (account.address.toLowerCase() !== expected || await client.getChainId() !== 4663) throw new Error('Unexpected deployer or chain');
const artifact = JSON.parse(readFileSync('contracts/out-lens-ipfs/BellSwapLens.sol/BellSwapLens.json', 'utf8'));
const pools = JSON.parse(readFileSync('apps/web/content/mainnet-pool-lenses.json', 'utf8')).pools;
const file = 'evidence/deploy/mainnet-4663-lenses.json';
const record = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { chainId: 4663, deployer: account.address, contracts: [] };
const save = () => writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
const hookAbi = parseAbi(['function poolId() view returns (bytes32)']);
const lensAbi = parseAbi(['function boundHook() view returns (address)', 'function boundPoolId() view returns (bytes32)']);
for (const p of pools) {
  const id = await client.readContract({ address: p.hook, abi: hookAbi, functionName: 'poolId' });
  if (id.toLowerCase() !== p.poolId.toLowerCase()) throw new Error(`Hook binding mismatch for ${p.poolId}`);
  const entry = record.contracts.find((x) => x.poolId.toLowerCase() === p.poolId.toLowerCase());
  if (entry?.tx && !entry.address) {
    const receipt = await client.getTransactionReceipt({ hash: entry.tx });
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Pending or failed deployment ${entry.tx}`);
    Object.assign(entry, { address: receipt.contractAddress, blockNumber: String(receipt.blockNumber), gasUsed: String(receipt.gasUsed), status: 'deployed' }); save();
  }
}
let remaining = pools.filter((p) => !record.contracts.find((x) => x.poolId.toLowerCase() === p.poolId.toLowerCase() && x.address));
const price = (await client.getGasPrice()) * 115n / 100n;
let estimatedTotal = 0n;
for (const p of remaining) {
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [p.hook] });
  estimatedTotal += await client.estimateGas({ account, data, gasPrice: 0n });
}
const balance = await client.getBalance({ address: account.address });
console.log(`Preflight: ${remaining.length} deployments; estimated ${formatEther(estimatedTotal * price)} ETH; balance ${formatEther(balance)} ETH`);
if (balance < estimatedTotal * price) throw new Error('Balance is lower than the current estimated gas cost');
for (const p of remaining) {
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [p.hook] });
  const gas = await client.estimateGas({ account, data, gasPrice: 0n });
  const gasPrice = (await client.getGasPrice()) * 115n / 100n;
  if (await client.getBalance({ address: account.address }) < gas * gasPrice) throw new Error('Insufficient balance for next deployment');
  const hash = await wallet.deployContract({ chain: null, abi: artifact.abi, bytecode: artifact.bytecode.object, args: [p.hook], gas: gas * 105n / 100n, gasPrice });
  const entry = { poolId: p.poolId, hook: p.hook, tx: hash, status: 'submitted', address: null };
  record.contracts.push(entry); save();
  console.log(`Submitted ${p.poolId} ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120000 });
  if (receipt.status !== 'success' || !receipt.contractAddress) { entry.status = 'failed'; save(); throw new Error(`Deployment failed: ${hash}`); }
  Object.assign(entry, { address: receipt.contractAddress, blockNumber: String(receipt.blockNumber), gasUsed: String(receipt.gasUsed), effectiveGasPrice: String(receipt.effectiveGasPrice), status: 'deployed' }); save();
  let hook, id;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      [hook, id] = await Promise.all([
        client.readContract({ address: entry.address, abi: lensAbi, functionName: 'boundHook' }),
        client.readContract({ address: entry.address, abi: lensAbi, functionName: 'boundPoolId' }),
      ]);
      break;
    } catch (error) {
      if (attempt === 11) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (hook.toLowerCase() !== p.hook.toLowerCase() || id.toLowerCase() !== p.poolId.toLowerCase()) throw new Error(`Deployed binding mismatch: ${entry.address}`);
  console.log(`Confirmed ${entry.address} block ${entry.blockNumber}`);
  if (process.argv.includes('--one')) break;
}
console.log(`Deployments recorded: ${record.contracts.filter((x) => x.status === 'deployed').length}`);
