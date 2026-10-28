#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, http, decodeEventLog, parseAbi } from 'viem';
import FactoryArtifact from '../../contracts/out/BellPoolFactory.sol/BellPoolFactory.json' with { type: 'json' };

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const c = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });
const manifest = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));
const adapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const queue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));
const existingPool = JSON.parse(readFileSync('evidence/deploy/testnet-pool-created.json', 'utf8'));
const txHash = process.argv[2] || existingPool.createTx;
const receipt = await c.getTransactionReceipt({ hash: txHash });
if (receipt.status !== 'success') throw new Error(`createAndSeed reverted: ${txHash}`);

const decoded = receipt.logs
  .map((log) => {
    try { return decodeEventLog({ abi: FactoryArtifact.abi, data: log.data, topics: log.topics }); }
    catch { return null; }
  });
const created = decoded.find((e) => e?.eventName === 'PoolCreated');
const activated = decoded.find((e) => e?.eventName === 'PoolActivated');
if (!created || !activated) throw new Error('PoolCreated/PoolActivated missing from successful receipt');

const hook = created.args.hook;
const poolId = created.args.poolId;
const code = await c.getBytecode({ address: hook });
if (!code || code === '0x') throw new Error(`No code at hook ${hook}`);

const HOOK_ABI = parseAbi([
  'function config() view returns ((address token0,address token1,bytes32 asset0,bytes32 asset1,address poolManager,address positionManager,address factory,address assetRegistry,address calendarRegistry,address safetyController,address treasuryAdapter,uint8 poolClass,uint8 liquidityMode,uint8 referenceMode,int24 tickSpacing,uint128[2] tradeCap,uint128[2] windowCap,uint128[2] closureCap,bytes32 policyId))',
  'function state() view returns ((uint8 lifecycle,uint8 mode,bool closedLatched,uint64 closureNonce,uint64 reopenCandidateAt,uint64 oldValidUntil,uint64[2] reopenBaseObservations,uint64[2] lastOpenObservations,uint64 pauseNonce,uint64 bellStart,uint64 corporateUntil))',
  'function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
]);
const [config, state, policy] = await Promise.all([
  c.readContract({ address: hook, abi: HOOK_ABI, functionName: 'config' }),
  c.readContract({ address: hook, abi: HOOK_ABI, functionName: 'state' }),
  c.readContract({ address: hook, abi: HOOK_ABI, functionName: 'getPolicy' }),
]);

const evidence = {
  hook,
  poolId,
  createTx: txHash,
  blockNumber: Number(receipt.blockNumber),
  transactionIndex: Number(receipt.transactionIndex),
  token0: config.token0,
  token1: config.token1,
  asset0: config.asset0,
  asset1: config.asset1,
  stockToken: adapters.stockToken,
  stockAssetId: queue.stock.descriptorId,
  wethAssetId: queue.weth.descriptorId,
  lifecycle: Number(state.lifecycle),
  phase: Number(policy.phase),
  policyObservedAt: new Date().toISOString(),
  policySnapshot: {
    mode: Number(policy.mode),
    canSwap: policy.canSwap,
    reasonBits: policy.reasonBits.toString(),
  },
  codeBytes: (code.length - 2) / 2,
  verifiedAt: new Date().toISOString(),
};
writeFileSync('evidence/deploy/testnet-pool-created.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
