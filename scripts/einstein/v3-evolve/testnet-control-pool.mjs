#!/usr/bin/env node
/**
 * v3 Evolve on Robinhood testnet: creates the CONTROL pool, a plain Uniswap v4 pool with no hook and a fixed 30 bps fee, with the same
 * tokens, the same opening price, the same ticks and the same liquidity as the Einstein pool. Also deploys the one swap helper both
 * pools use. Dry run by default.
 *
 *   node scripts/einstein/v3-evolve/testnet-control-pool.mjs --pool evidence/einstein/testnet-pool-<ts>.json
 *   node scripts/einstein/v3-evolve/testnet-control-pool.mjs --pool <file> --broadcast
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, encodeAbiParameters, parseAbiParameters, encodePacked, maxUint256, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import ExecutorArtifact from '../../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const broadcast = process.argv.includes('--broadcast');
const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const poolLog = JSON.parse(readFileSync(arg('pool'), 'utf8'));
const inputs = JSON.parse(readFileSync('evidence/deploy/testnet-46630-pq-inputs.json', 'utf8'));
const manifest = JSON.parse(readFileSync('evidence/deploy/pq-hooks-testnet-46630.json', 'utf8'));
const NVDA = manifest.assetDescriptors.NVDA.token; const USDG = manifest.assetDescriptors.USDG.token;
const [c0, c1] = BigInt(NVDA) < BigInt(USDG) ? [NVDA, USDG] : [USDG, NVDA];
const FEE = 3000; const SPACING = 60;
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const pk = env.DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const pc = createPublicClient({ transport: http(rpcUrl) });
const wc = createWalletClient({ account, transport: http(rpcUrl) });
if (await pc.getChainId() !== 46630) throw new Error('RPC is not Robinhood testnet');
const req = poolLog.request;
const key = { currency0: c0, currency1: c1, fee: FEE, tickSpacing: SPACING, hooks: '0x0000000000000000000000000000000000000000' };
const POOL_MANAGER = inputs.poolManager; const POSM = inputs.positionManager; const PERMIT2 = inputs.permit2;
const pmAbi = parseAbi(['function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) returns (int24 tick)',
  'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)']);
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const permit2 = parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']);
const posmAbi = parseAbi(['function modifyLiquidities(bytes unlockData,uint256 deadline) payable', 'function nextTokenId() view returns (uint256)']);
console.log(JSON.stringify({ mode: broadcast ? 'BROADCAST' : 'DRY', currency0: c0, currency1: c1, fee: FEE, tickSpacing: SPACING, sqrtPriceX96: req.sqrtPriceX96, tickLower: req.tickLower, tickUpper: req.tickUpper, liquidity: req.liquidity }, null, 2));
if (!broadcast) process.exit(0);

const wait = async (hash, what) => { const r = await pc.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw new Error(`${what} failed ${hash}`); return r; };
const log = { createdAt: new Date().toISOString(), txs: {} };

// 1. The swap helper both pools use.
const execHash = await wc.deployContract({ abi: ExecutorArtifact.abi, bytecode: ExecutorArtifact.bytecode.object, args: [POOL_MANAGER] });
const execReceipt = await wait(execHash, 'executor');
log.executor = execReceipt.contractAddress; log.txs.executor = execHash; console.log('executor', log.executor);

// 2. Initialize the control pool.
const initHash = await wc.writeContract({ address: POOL_MANAGER, abi: pmAbi, functionName: 'initialize', args: [key, BigInt(req.sqrtPriceX96)] });
const initReceipt = await wait(initHash, 'initialize');
const init = parseEventLogs({ abi: pmAbi, logs: initReceipt.logs, eventName: 'Initialize' })[0];
log.poolId = init.args.id; log.txs.initialize = initHash; log.initializeBlock = Number(initReceipt.blockNumber); console.log('control pool', log.poolId);

// 3. Approvals: token -> Permit2 -> PositionManager.
const big = 2n ** 160n - 1n; const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
for (const t of [c0, c1]) {
  await wait(await wc.writeContract({ address: t, abi: erc20, functionName: 'approve', args: [PERMIT2, maxUint256] }), 'approve permit2');
  await wait(await wc.writeContract({ address: PERMIT2, abi: permit2, functionName: 'approve', args: [t, POSM, big, exp] }), 'permit2 approve');
}

// 4. Mint the position with the same ticks and liquidity as the Einstein pool.
const keyTuple = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const mintParams = encodeAbiParameters(parseAbiParameters(`${keyTuple} key,int24 tickLower,int24 tickUpper,uint256 liquidity,uint128 amount0Max,uint128 amount1Max,address owner,bytes hookData`),
  [key, req.tickLower, req.tickUpper, BigInt(req.liquidity), 2n ** 127n, 2n ** 127n, account.address, '0x']);
const settleParams = encodeAbiParameters(parseAbiParameters('address currency0,address currency1'), [c0, c1]);
const actions = encodePacked(['uint8', 'uint8'], [0x02, 0x0d]);
const unlockData = encodeAbiParameters(parseAbiParameters('bytes actions,bytes[] params'), [actions, [mintParams, settleParams]]);
const tokenId = await pc.readContract({ address: POSM, abi: posmAbi, functionName: 'nextTokenId' });
const sim = await pc.simulateContract({ address: POSM, abi: posmAbi, functionName: 'modifyLiquidities', args: [unlockData, BigInt(Math.floor(Date.now() / 1000) + 900)], account });
const gas = await pc.estimateContractGas({ address: POSM, abi: posmAbi, functionName: 'modifyLiquidities', args: [unlockData, BigInt(Math.floor(Date.now() / 1000) + 900)], account });
const seedHash = await wc.writeContract({ ...sim.request, gas: (gas * 13n) / 10n });
const seedReceipt = await wait(seedHash, 'seed');
log.txs.seed = seedHash; log.seedBlock = Number(seedReceipt.blockNumber); log.positionTokenId = String(tokenId);
log.key = key; log.request = req; log.poolManager = POOL_MANAGER; log.positionManager = POSM;
const out = `evidence/einstein/testnet-control-pool-${Date.now()}.json`;
writeFileSync(out, `${JSON.stringify(log, null, 2)}\n`);
console.log(`control pool seeded: ${seedHash} block ${seedReceipt.blockNumber}\nwrote ${out}`);
