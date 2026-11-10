#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicClient, http, parseAbiItem } from 'viem';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const DEFAULT_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const LOG_PAGE = 20_000_000n;
const FIRST_BELL_FACTORY_BLOCK = 100_896_403n;
const PRE_AUCTION_FACTORY = '0x5bf1aa3913c59215ea90a3fb9482bf6f32d8152b';
const BELL_PERMISSION_MASK = 0x3fff;
const MUST_BE_DISABLED = (1 << 9) | (1 << 8) | (1 << 0);

const poolCreatedEvent = parseAbiItem(
  'event PoolCreated(address indexed hook, bytes32 indexed poolId, bytes32 configHash, address indexed creator, address recipient)',
);
const initializeEvent = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
);
const swapEvent = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
);

export function hookFlags(hook) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(hook)) throw new TypeError(`Invalid hook address: ${hook}`);
  return Number(BigInt(hook) & BigInt(BELL_PERMISSION_MASK));
}

export function hookPermissionResult(hook) {
  const flags = hookFlags(hook);
  const forbiddenBits = flags & MUST_BE_DISABLED;
  return { flags, forbiddenBits, pass: forbiddenBits === 0 };
}

export function phaseSessionLabel(phase) {
  return ['UNKNOWN', 'PRE', 'REGULAR', 'POST', 'OVERNIGHT', 'CLOSED'][Number(phase)] ?? 'UNKNOWN';
}

export function isLaterSwap(log, prior) {
  return !prior || log.blockNumber > BigInt(prior.blockNumber)
    || (log.blockNumber === BigInt(prior.blockNumber) && log.logIndex > prior.logIndex);
}

export function checkRuleReceipt(entry, receipt) {
  if (entry.status !== 'DONE') return { id: entry.id, status: entry.status ?? 'PENDING' };
  if (!receipt) return { id: entry.id, status: 'FAIL', expected: entry.expect, actual: 'MISSING', error: entry.error ?? null };
  const actual = receipt.status === 'success' || receipt.status === 1 || receipt.status === 1n ? 'SUCCEEDS' : 'REVERTS';
  const pass = actual === entry.expect;
  return {
    id: entry.id,
    status: pass ? 'PASS' : 'FAIL',
    expected: entry.expect,
    actual,
    error: entry.error ?? null,
    errorSource: entry.error ? 'recorded test evidence; receipt status alone does not prove the error' : null,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function loadEnv() {
  const envFile = resolve(ROOT, '.env');
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
}

export async function getLogsChunked(client, options) {
  let requests = 0;
  const scan = async (fromBlock, toBlock) => {
    if (++requests > 512) throw new Error('RPC log scan exceeded its request limit; configure an archive or secondary RPC with wider eth_getLogs ranges');
    try {
      return await client.getLogs({ ...options, fromBlock, toBlock });
    } catch (error) {
      const detail = String(error?.shortMessage ?? error?.message ?? error);
      if (fromBlock >= toBlock || !/range|too many|more than|limit|response size|block span/i.test(detail)) {
        throw new Error('RPC log scan failed; configure an archive or secondary RPC and retry');
      }
      const middle = fromBlock + (toBlock - fromBlock) / 2n;
      const left = await scan(fromBlock, middle);
      const right = await scan(middle + 1n, toBlock);
      return [...left, ...right];
    }
  };
  const logs = [];
  for (let start = options.fromBlock; start <= options.toBlock; start += LOG_PAGE) {
    const end = start + LOG_PAGE - 1n < options.toBlock ? start + LOG_PAGE - 1n : options.toBlock;
    logs.push(...await scan(start, end));
  }
  return logs;
}

function short(address) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

async function verify() {
  loadEnv();
  const [deployment, verification, ruleTests, firstDeployment, priorFactory, abiManifest] = await Promise.all([
    readJson(resolve(ROOT, 'evidence/deploy/mainnet-4663.json')),
    readJson(resolve(ROOT, 'evidence/deploy/mainnet-4663-verification.json')),
    readJson(resolve(ROOT, 'deployments/rule-tests.json')),
    readJson(resolve(ROOT, 'evidence/deploy/mainnet-4663-broadcast.json')),
    readJson(resolve(ROOT, 'evidence/deploy/mainnet-4663-factory-update.json')),
    readJson(resolve(ROOT, 'packages/protocol/generated/abi-manifest.json')),
  ]);
  const rpcUrl = process.env.RH_MAINNET_RPC_SECONDARY
    || process.env.RH_MAINNET_ARCHIVE_RPC
    || process.env.RH_MAINNET_RPC_PRIMARY
    || process.env.BELL_RPC_URL
    || DEFAULT_RPC;
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 30_000 }) });
  console.log('Checking public RPC chain and block...');
  const chainId = await client.getChainId();
  if (chainId !== 4663 || Number(deployment.chainId) !== 4663 || Number(ruleTests.mainnet?.chainId) !== 4663) {
    throw new Error(`Expected Robinhood Chain Mainnet 4663; RPC returned ${chainId}`);
  }

  const head = await client.getBlockNumber();
  const factories = [...new Set([
    firstDeployment.contracts.BellPoolFactory.address,
    priorFactory.poolFactory,
    PRE_AUCTION_FACTORY,
    deployment.poolFactory,
  ].map((address) => String(address).toLowerCase()))];
  console.log(`Scanning ${factories.length} BELL factory generations from block ${FIRST_BELL_FACTORY_BLOCK} through ${head}...`);
  const factoryLogs = await Promise.all(factories.map(async (factory) => ({
    factory,
    logs: await getLogsChunked(client, {
      address: factory,
      event: poolCreatedEvent,
      fromBlock: FIRST_BELL_FACTORY_BLOCK,
      toBlock: head,
    }),
  })));
  const allCreated = factoryLogs.flatMap(({ factory, logs }) => logs.map((log) => ({ ...log, factory })));
  const unique = [...new Map(allCreated.map((log) => [String(log.args.poolId).toLowerCase(), log])).values()];
  const pools = [];

  for (const createdLog of unique) {
    const poolId = createdLog.args.poolId;
    const hook = createdLog.args.hook;
    console.log(`Reading PoolManager Initialize for ${short(poolId)}...`);
    const initialized = await getLogsChunked(client, {
      address: deployment.poolManager,
      event: initializeEvent,
      args: { id: poolId },
      fromBlock: createdLog.blockNumber,
      toBlock: head,
    });
    const init = initialized.find((log) => String(log.args.hooks).toLowerCase() === hook.toLowerCase());
    if (!init) {
      pools.push({ poolId, hook, flags: null, permission: 'FAIL', reason: 'PoolManager Initialize event not found' });
      continue;
    }

    const permission = hookPermissionResult(hook);
    console.log(`Reading Swap events for ${short(poolId)}...`);
    const swaps = await getLogsChunked(client, {
      address: deployment.poolManager,
      event: swapEvent,
      args: { id: poolId },
      fromBlock: init.blockNumber,
      toBlock: head,
    });
    const latestBySession = new Map();
    const phaseByBlock = new Map();
    for (const log of swaps) {
      let phase = phaseByBlock.get(log.blockNumber.toString());
      if (phase === undefined) {
        try {
          const policy = await client.readContract({
            address: hook,
            abi: abiManifest.interfaces.IBellHook,
            functionName: 'getPolicy',
            blockNumber: log.blockNumber,
          });
          phase = Number(policy.phase);
          phaseByBlock.set(log.blockNumber.toString(), phase);
        } catch {
          // Effective fees can vary; fee alone cannot establish the historical session.
          phase = null;
          phaseByBlock.set(log.blockNumber.toString(), null);
        }
      }
      const session = phase === null ? 'UNKNOWN' : phaseSessionLabel(phase);
      const prior = latestBySession.get(session);
      if (isLaterSwap(log, prior)) {
        latestBySession.set(session, {
          session,
          fee: Number(log.args.fee),
          sessionSource: phase === null ? 'unavailable' : 'hook policy at event block',
          blockNumber: log.blockNumber.toString(),
          logIndex: log.logIndex,
          tx: log.transactionHash,
          explorer: `${EXPLORER}/tx/${log.transactionHash}`,
        });
      }
    }
    pools.push({
      poolId,
      hook,
      factory: createdLog.factory,
      hookFlags: `0x${permission.flags.toString(16).padStart(4, '0')}`,
      permission: permission.pass ? 'PASS' : 'FAIL',
      initialization: {
        tx: init.transactionHash,
        blockNumber: init.blockNumber.toString(),
        explorer: `${EXPLORER}/tx/${init.transactionHash}`,
      },
      token0: init.args.currency0,
      token1: init.args.currency1,
      latestSwapBySession: [...latestBySession.values()].sort((a, b) => a.session.localeCompare(b.session)),
    });
  }

  const ruleEntries = [];
  console.log('Checking recorded rule-test receipts...');
  for (const entry of ruleTests.mainnet.entries ?? []) {
    const poolId = entry.poolId ?? entry.pool ?? null;
    if (entry.status !== 'DONE' || !entry.tx) {
      ruleEntries.push({ id: entry.id, rule: entry.rule, poolId, status: 'PENDING', expected: entry.expect });
      continue;
    }
    const receipt = await client.getTransactionReceipt({ hash: entry.tx });
    const result = checkRuleReceipt(entry, receipt);
    ruleEntries.push({
      ...result,
      rule: entry.rule,
      poolId,
      tx: entry.tx,
      blockNumber: receipt.blockNumber.toString(),
      explorer: `${EXPLORER}/tx/${entry.tx}`,
    });
  }

  const failed = pools.length === 0 || pools.some((pool) => pool.permission !== 'PASS' || !pool.initialization)
    || ruleEntries.some((entry) => entry.status === 'FAIL');
  const incomplete = ruleEntries.some((entry) => entry.status !== 'PASS');
  const output = {
    chainId,
    observedAt: new Date().toISOString(),
    observedBlock: head.toString(),
    poolCount: pools.length,
    pools,
    ruleTests: ruleEntries,
    status: failed ? 'FAIL' : incomplete ? 'INCOMPLETE' : 'PASS',
  };

  const lensMapPath = resolve(ROOT, 'apps/web/content/mainnet-pool-lenses.json');
  let previousLensMap = { pools: [] };
  try { previousLensMap = await readJson(lensMapPath); } catch { /* First verification run. */ }
  const previousByPool = new Map((previousLensMap.pools ?? []).map((pool) => [pool.poolId.toLowerCase(), pool]));
  const webLensMap = {
    version: 1,
    chainId,
    observedAt: output.observedAt,
    observedBlock: output.observedBlock,
    source: 'PoolCreated and PoolManager Initialize events from the documented BELL Mainnet factories',
    pools: pools.map((pool) => {
      const prior = previousByPool.get(pool.poolId.toLowerCase());
      return {
        poolId: pool.poolId,
        hook: pool.hook,
        factory: pool.factory,
        lens: prior?.hook?.toLowerCase() === pool.hook.toLowerCase() ? prior.lens ?? null : null,
        initializeTx: pool.initialization?.tx ?? null,
        initializeBlock: pool.initialization?.blockNumber ?? null,
      };
    }),
  };

  console.log(`BELL Mainnet verifier · chain ${chainId} · block ${head}`);
  console.table(pools.map((pool) => ({
    poolId: short(pool.poolId), tokens: `${short(pool.token0)} / ${short(pool.token1)}`,
    hook: short(pool.hook), factory: short(pool.factory), flags: pool.hookFlags ?? '—',
    permissions: pool.permission, swaps: pool.latestSwapBySession?.length ?? 0,
  })));
  console.log('Latest PoolManager Swap fees by session');
  console.table(pools.flatMap((pool) => (pool.latestSwapBySession ?? []).map((swap) => ({
    poolId: short(pool.poolId), session: swap.session, fee: swap.fee,
    block: swap.blockNumber, tx: short(swap.tx),
  }))));
  console.table(ruleEntries.map(({ id, status, expected, actual, error }) => ({ id, status, expected, actual, error })));
  await writeFile(resolve(process.cwd(), 'verify-output.json'), `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(resolve(ROOT, 'apps/web/content/mainnet-verification.json'), `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(lensMapPath, `${JSON.stringify(webLensMap, null, 2)}\n`);
  console.log(`Wrote verify-output.json (${pools.length} pools, ${ruleEntries.length} rule tests): ${output.status}`);
  if (failed || (incomplete && process.argv.includes('--require-complete'))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verify().catch((error) => {
    console.error(`verify-bell failed: ${String(error?.shortMessage ?? error?.message ?? error).slice(0, 240)}`);
    process.exitCode = 1;
  });
}
