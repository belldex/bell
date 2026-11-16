#!/usr/bin/env node
/**
 * Deploys the BellSwapLens for the first Einstein pool, built with the metadata hash embedded (contracts/out-lens-ipfs) so that
 * Sourcify can report an exact match. Dry run by default.
 *
 *   node scripts/einstein/deploy-lens.mjs
 *   node scripts/einstein/deploy-lens.mjs --broadcast
 *
 * The deployer is RH_MAINNET_DEPLOYER_PRIVATE_KEY, like the lenses of the existing pools. The Lens is read-only and bound to one hook.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, encodeDeployData, parseAbi, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const broadcast = process.argv.includes('--broadcast');
const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const proof = JSON.parse(readFileSync('evidence/einstein/proof.json', 'utf8'));
const { hook, poolId } = proof.pool;
const artifact = JSON.parse(readFileSync('contracts/out-lens-ipfs/BellSwapLens.sol/BellSwapLens.json', 'utf8'));
const rpc = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY;
const key = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const pc = createPublicClient({ transport: http(rpc, { timeout: 30000 }) });
const wc = createWalletClient({ account, transport: http(rpc, { timeout: 30000 }) });
if ((await pc.getChainId()) !== 4663) throw new Error('not Robinhood Chain mainnet');

const hookAbi = parseAbi(['function poolId() view returns (bytes32)']);
const lensAbi = parseAbi(['function boundHook() view returns (address)', 'function boundPoolId() view returns (bytes32)']);
const id = await pc.readContract({ address: hook, abi: hookAbi, functionName: 'poolId' });
if (id.toLowerCase() !== poolId.toLowerCase()) throw new Error('the hook does not report the pool id in proof.json');

const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [hook] });
const gas = await pc.estimateGas({ account, data });
const price = (await pc.getGasPrice()) * 115n / 100n;
const balance = await pc.getBalance({ address: account.address });
console.log(`hook ${hook}\nestimated gas ${gas}, about ${formatEther(gas * price)} ETH; deployer ${account.address} holds ${formatEther(balance)} ETH`);
if (balance < gas * price * 2n) throw new Error('not enough ETH for a safe margin');
if (!broadcast) { console.log('DRY RUN OK. Add --broadcast to deploy.'); process.exit(0); }

const hash = await wc.deployContract({ chain: null, abi: artifact.abi, bytecode: artifact.bytecode.object, args: [hook], gas: (gas * 12n) / 10n, gasPrice: price });
const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 120000 });
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`deployment failed: ${hash}`);
let bound;
for (let i = 0; i < 12; i += 1) {
  try {
    bound = await Promise.all([
      pc.readContract({ address: receipt.contractAddress, abi: lensAbi, functionName: 'boundHook' }),
      pc.readContract({ address: receipt.contractAddress, abi: lensAbi, functionName: 'boundPoolId' }),
    ]);
    break;
  } catch (e) { if (i === 11) throw e; await new Promise((r) => setTimeout(r, 2000)); }
}
if (bound[0].toLowerCase() !== hook.toLowerCase() || bound[1].toLowerCase() !== poolId.toLowerCase()) throw new Error('the Lens is bound to the wrong hook or pool');
const record = { chainId: 4663, poolId, hook, lens: receipt.contractAddress, tx: hash, block: Number(receipt.blockNumber), gasUsed: Number(receipt.gasUsed), deployer: account.address };
writeFileSync('evidence/einstein/lens.json', `${JSON.stringify(record, null, 2)}\n`);
console.log(`Lens ${receipt.contractAddress} in block ${receipt.blockNumber}\nwrote evidence/einstein/lens.json`);
