#!/usr/bin/env node
/**
 * Removes part of the liquidity of the first Einstein pool's position straight through the PositionManager, to show that an
 * exit needs no hook call and no post-quantum signature. Dry run by default.
 *
 *   node scripts/einstein/exit-first-pool.mjs --percent 20                # simulate
 *   node scripts/einstein/exit-first-pool.mjs --percent 20 --broadcast
 *   node scripts/einstein/exit-first-pool.mjs --percent 100 --broadcast   # the full exit, which ends the pool for later sessions
 *
 * The hook has no remove-liquidity callback (its address bits 9, 8 and 0 are off), so nothing here is routed through it.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, encodeAbiParameters, encodeFunctionData, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const broadcast = process.argv.includes('--broadcast');
const percent = BigInt(arg('percent', '20'));
if (percent < 1n || percent > 100n) throw new Error('--percent must be between 1 and 100');
const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const dir = 'evidence/einstein';
const pool = JSON.parse(readFileSync(`${dir}/${readdirSync(dir).filter((f) => f.startsWith('first-pool-')).sort().pop()}`, 'utf8'));
const mainnet = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const pq = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet.json', 'utf8'));
const USDG = pq.assetDescriptors.USDG.token;
const NVDA = pq.assetDescriptors.NVDA.token;
const positionManager = mainnet.positionManager;

const rpcUrl = arg('rpc', env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY);
const rawKey = env[arg('key', 'LP_TEST_PRIVATE_KEY')];
const account = privateKeyToAccount(rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const pm = parseAbi([
  'function getPositionLiquidity(uint256) view returns (uint128)',
  'function ownerOf(uint256) view returns (address)',
  'function modifyLiquidities(bytes unlockData, uint256 deadline) payable',
]);
const tokenId = BigInt(pool.tokenId);
const [liquidity, owner] = await Promise.all([
  publicClient.readContract({ address: positionManager, abi: pm, functionName: 'getPositionLiquidity', args: [tokenId] }),
  publicClient.readContract({ address: positionManager, abi: pm, functionName: 'ownerOf', args: [tokenId] }),
]);
if (owner.toLowerCase() !== account.address.toLowerCase()) throw new Error(`position ${tokenId} is owned by ${owner}, not ${account.address}`);
const remove = (liquidity * percent) / 100n;
console.log(`position ${tokenId} holds ${liquidity}; removing ${percent}% = ${remove}`);

const actions = '0x0111';
const params = [
  encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }], [tokenId, remove, 0n, 0n, '0x']),
  encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [USDG, NVDA, account.address]),
];
const unlockData = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, params]);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
const sim = await publicClient.simulateContract({ address: positionManager, abi: pm, functionName: 'modifyLiquidities', args: [unlockData, deadline], account });
console.log('simulation passed');
if (!broadcast) { console.log('DRY RUN OK. Add --broadcast to send.'); process.exit(0); }

const hash = await walletClient.writeContract(sim.request);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
const after = await publicClient.readContract({ address: positionManager, abi: pm, functionName: 'getPositionLiquidity', args: [tokenId], blockNumber: receipt.blockNumber });
const hookTouched = receipt.logs.some((l) => l.address.toLowerCase() === pool.hook.toLowerCase());
const entry = { tx: hash, block: Number(receipt.blockNumber), timestamp: Number(block.timestamp), status: receipt.status, percent: Number(percent), liquidityBefore: String(liquidity), liquidityAfter: String(after), hookEmittedLogs: hookTouched, gasUsed: Number(receipt.gasUsed) };
const out = `${dir}/exits.json`;
let all = []; try { all = JSON.parse(readFileSync(out, 'utf8')); } catch { /* first exit */ }
all.push(entry);
writeFileSync(out, `${JSON.stringify(all, null, 2)}\n`);
console.log(`exit ${hash} status ${receipt.status}; liquidity ${liquidity} -> ${after}; hook emitted logs: ${hookTouched}`);
