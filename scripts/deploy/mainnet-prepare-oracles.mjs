#!/usr/bin/env node
/** Prime Registry health before creating a pool, or checkpoint an existing Hook's recovery.
 * Defaults to eth_call simulation. Only --broadcast AND --i-authorize-spend enable a write.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildOraclePreparation, executeOraclePreparation, fetchPoolOracleUpdates, ORACLE_POOL_CONFIG_ABI,
  resolveOraclePair, validateCloseBoundary, validateOraclePoolPair,
} from './mainnet-prepare-request.mjs';

function arg(name, fallback = null) {
  const match = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

const stock = arg('stock')?.toUpperCase();
const counterasset = arg('counterasset')?.toUpperCase();
if (!stock || !counterasset) throw new Error('explicit --stock and --counterasset are required');
const broadcast = process.argv.includes('--broadcast');
const authorized = process.argv.includes('--i-authorize-spend');
if (broadcast && !authorized) throw new Error('broadcast blocked: explicit --i-authorize-spend is required');
const hook = arg('hook');
if (hook && (!/^0x[0-9a-f]{40}$/i.test(hook) || BigInt(hook) === 0n)) throw new Error('--hook must be a nonzero EVM address');

const env = { ...process.env };
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match && env[match[1]] === undefined) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}
const quoteUrl = arg('quote-url', env.BELL_QUOTE_SERVICE_URL);
if (!quoteUrl) throw new Error('--quote-url or BELL_QUOTE_SERVICE_URL is required');
if (!env.RH_MAINNET_RPC_PRIMARY) throw new Error('RH_MAINNET_RPC_PRIMARY is required');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = readJson('evidence/deploy/mainnet-4663.json');
if (Number(manifest.chainId) !== 4663) throw new Error('manifest chainId mismatch');
const assetQueue = readJson(env.BELL_MAINNET_ASSET_QUEUE || 'evidence/deploy/mainnet-4663-asset-queue.json');
const pair = resolveOraclePair({ stock, counterasset, assetQueue });
const publicClient = createPublicClient({ transport: http(env.RH_MAINNET_RPC_PRIMARY) });
if (await publicClient.getChainId() !== 4663) throw new Error('RPC chainId mismatch; expected 4663');

const descriptorAbi = parseAbi(['function descriptorIdForToken(address) view returns (bytes32)']);
await Promise.all(pair.legs.map(async (leg) => {
  const admittedId = await publicClient.readContract({ address: manifest.assetRegistry, abi: descriptorAbi, functionName: 'descriptorIdForToken', args: [leg.token] });
  if (admittedId.toLowerCase() !== leg.assetId) throw new Error(`admitted descriptor mismatch for ${leg.symbol}`);
}));
const hookConfig = hook ? await publicClient.readContract({ address: hook, abi: ORACLE_POOL_CONFIG_ABI, functionName: 'config' }) : undefined;
if (hook) {
  validateOraclePoolPair(pair, hookConfig);
  if (hookConfig.assetRegistry.toLowerCase() !== manifest.assetRegistry.toLowerCase()
    || hookConfig.calendarRegistry.toLowerCase() !== manifest.calendarRegistry.toLowerCase()) throw new Error('Hook registry wiring does not match the manifest');
}

const closeBoundaries = {};
const requestedBoundaries = [[stock, arg('close-boundary-hash')], [counterasset, arg('counter-close-boundary-hash')]].filter(([, hash]) => hash !== null);
if (requestedBoundaries.length) {
  const now = (await publicClient.getBlock()).timestamp;
  const calendarAbi = parseAbi(['function nextInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']);
  await Promise.all(requestedBoundaries.map(async ([symbol, hash]) => {
    const leg = pair.legs.find((entry) => entry.symbol === symbol && entry.isStock);
    if (!leg) throw new Error(`close boundary requires a stock leg: ${symbol}`);
    const leaf = await publicClient.readContract({ address: manifest.calendarRegistry, abi: calendarAbi, functionName: 'nextInterval', args: [leg.assetId] });
    closeBoundaries[symbol] = validateCloseBoundary({ hash, assetId: leg.assetId, leaf, chainId: 4663, calendarRegistry: manifest.calendarRegistry, now });
  }));
}

const updates = await fetchPoolOracleUpdates({ pair, quoteUrl, closeBoundaries });
const call = buildOraclePreparation({ pair, updates, sessionRegistry: manifest.sessionRegistry, hook, hookConfig });
const pk = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (broadcast && !pk) throw new Error('authorized broadcast requires RH_MAINNET_DEPLOYER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY');
const account = broadcast ? privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`) : arg('account', env.BELL_OPERATOR_ADDRESS) ?? undefined;
const walletClient = broadcast ? createWalletClient({ account, transport: http(env.RH_MAINNET_RPC_PRIMARY) }) : undefined;
const result = await executeOraclePreparation({ call, publicClient, account, broadcast, authorized, walletClient });
console.log(JSON.stringify({ mode: result.mode, chainId: 4663, stock, counterasset, target: call.address, function: call.functionName, stocks: pair.stockSymbols, hash: result.hash }, null, 2));
console.log(hook ? 'Hook recovery checkpoint selected.' : 'SessionRegistry health priming selected; create the pool only after its health checks pass.');
console.log('A stale pool needs a second prepare call with a new quote and advanced observation at least 60 seconds later. A reverting swap cannot persist recovery.');
if (!broadcast) console.log('Simulation passed; no transaction sent. Broadcasting requires --broadcast --i-authorize-spend.');
else {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: result.hash });
  if (receipt.status !== 'success') throw new Error(`oracle preparation reverted: ${result.hash}`);
  console.log(`Oracle preparation confirmed: ${result.hash}`);
}
