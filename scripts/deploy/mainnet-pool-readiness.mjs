#!/usr/bin/env node
/**
 * Read-only readiness report for creating a SESSION_ONLY pool.
 *
 * Answers one question with onchain evidence: can a pool be created right now, and if not,
 * exactly which condition is missing. No transaction is built or signed.
 *
 *   node scripts/deploy/mainnet-pool-readiness.mjs --stock=AAPL --counterasset=WETH
 */
import { readFileSync, existsSync } from 'node:fs';
import { createPublicClient, http, parseAbi, formatEther, formatUnits, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const MAINNET_CHAIN_ID = 4663;
const PHASE = { 0: 'UNKNOWN', 1: 'PRE', 2: 'REGULAR', 3: 'POST', 4: 'OVERNIGHT', 5: 'CLOSED' };

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const env = { ...process.env };
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

const stockSymbol = (arg('stock', 'AAPL') || 'AAPL').toUpperCase();
const counterSymbol = (arg('counterasset', 'WETH') || 'WETH').toUpperCase();

const manifest = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const queue = JSON.parse(readFileSync('evidence/deploy/mainnet-4663-asset-queue.json', 'utf8'));
const adapters = JSON.parse(readFileSync('evidence/deploy/mainnet-4663-chainlink-session-adapters.json', 'utf8'));

const key = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!key) throw new Error('deployer private key is required to read the deployer address');
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const client = createPublicClient({ transport: http(env.RH_MAINNET_RPC_PRIMARY) });

const stock = queue.stocks[stockSymbol];
if (!stock) throw new Error(`${stockSymbol} is not an admitted stock`);
const counter = counterSymbol === 'WETH' ? { token: manifest.weth, descriptorId: queue.weth.descriptorId }
  : counterSymbol === 'USDG' ? { token: manifest.feeToken, descriptorId: queue.usdg.descriptorId }
    : queue.counterassets?.[counterSymbol];
if (!counter) throw new Error(`${counterSymbol} is not an admitted counterasset`);

const CAL = parseAbi([
  'function currentInterval(bytes32) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
]);
const SES = parseAbi([
  'function health(bytes32) view returns ((bool ready,uint256 reasonBits,uint64 healthySince,uint64 validUntil,uint64 baselineObservation,uint64 latestObservation))',
]);
const ERC = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address,address) view returns (uint256)',
]);
const FEED = parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
const FACT = parseAbi(['function serviceFee() view returns (uint128)']);

const [block, interval, health, serviceFee] = await Promise.all([
  client.getBlock(),
  client.readContract({ address: manifest.calendarRegistry, abi: CAL, functionName: 'currentInterval', args: [stock.descriptorId] }),
  client.readContract({ address: manifest.sessionRegistry, abi: SES, functionName: 'health', args: [stock.descriptorId] }),
  client.readContract({ address: manifest.poolFactory, abi: FACT, functionName: 'serviceFee' }),
]);
const now = Number(block.timestamp);
const phase = Number(interval.phase);
const plannedClosed = phase === 5 && BigInt(interval.provenanceHash) !== 0n
  && now >= Number(interval.start) && now < Number(interval.end);
const healthOk = health.ready && BigInt(health.reasonBits) === 0n && Number(health.validUntil) > now;

const feedAddress = adapters.assets[stockSymbol]?.feed;
let feedAgeSeconds = null;
if (feedAddress) {
  const round = await client.readContract({ address: feedAddress, abi: FEED, functionName: 'latestRoundData' });
  feedAgeSeconds = now - Number(round[3]);
}

const tokens = {};
for (const [label, address] of [[stockSymbol, stock.token], [counterSymbol, counter.token], ['USDG(fee)', manifest.feeToken]]) {
  const [balance, decimals, symbol, allowance] = await Promise.all([
    client.readContract({ address, abi: ERC, functionName: 'balanceOf', args: [account.address] }),
    client.readContract({ address, abi: ERC, functionName: 'decimals' }),
    client.readContract({ address, abi: ERC, functionName: 'symbol' }).catch(() => label),
    client.readContract({ address, abi: ERC, functionName: 'allowance', args: [account.address, manifest.poolFactory] }),
  ]);
  tokens[label] = {
    address,
    balance: formatUnits(balance, Number(decimals)),
    allowanceToFactory: formatUnits(allowance, Number(decimals)),
    funded: balance > 0n,
  };
}

const nativeBalance = await client.getBalance({ address: account.address });

// The factory gate: health OR a proven planned close. Nothing else opens pool creation.
const blockers = [];
if (!healthOk && !plannedClosed) {
  blockers.push(healthOk ? null : 'health is not ready and the calendar phase is not a proven planned close');
}
if (!tokens[stockSymbol].funded) blockers.push(`deployer holds no ${stockSymbol}`);
if (!tokens[counterSymbol].funded) blockers.push(`deployer holds no ${counterSymbol}`);

console.log(JSON.stringify({
  chainId: await client.getChainId(),
  block: Number(block.number),
  chainTimeIso: new Date(now * 1000).toISOString(),
  deployer: account.address,
  pair: `${stockSymbol}/${counterSymbol}`,
  calendar: {
    phase: PHASE[phase] ?? phase,
    endsAtIso: new Date(Number(interval.end) * 1000).toISOString(),
    plannedClosed,
  },
  health: {
    ready: health.ready,
    reasonBits: health.reasonBits.toString(),
    validUntil: Number(health.validUntil),
    countsAsFresh: healthOk,
  },
  chainlinkFeed: {
    address: feedAddress ?? null,
    ageSeconds: feedAgeSeconds,
    limitSeconds: 120,
    fresh: feedAgeSeconds !== null && feedAgeSeconds < 120,
  },
  balances: tokens,
  nativeEth: formatEther(nativeBalance),
  serviceFeeUsdg: formatUnits(serviceFee, 6),
  canCreatePoolNow: blockers.length === 0,
  blockers,
  verdict: blockers.length === 0
    ? 'READY — create the pool now'
    : 'NOT_READY — the factory rejects createAndSeed (InvalidConfiguration) until a blocker clears',
}, null, 2));
