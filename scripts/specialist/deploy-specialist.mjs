#!/usr/bin/env node
/**
 * Deploys SpecialistRegistry on Robinhood Chain mainnet for NVDA. Dry run by default: it reads the live contracts the constructor will point at,
 * simulates the deployment and prints the plan. Sends nothing without --broadcast.
 *
 *   node scripts/specialist/deploy-specialist.mjs --label test --epoch-seconds 86400 --unbond-delay 86400 [--broadcast]
 *   node scripts/specialist/deploy-specialist.mjs --label production [--broadcast]        # one week epochs, 14 day unbond (the defaults)
 *
 * The contract has no owner and no setters, so every parameter is fixed here. The label goes into the manifest and onto the page: a `test`
 * instance runs with short epochs so a full cycle of bond, serve, score, slash and unbond fits in days; it is run by a team wallet.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, encodeDeployData, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const broadcast = process.argv.includes('--broadcast');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const env = {};
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); } } catch { /* CI */ }
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
const label = arg('label', 'production');
const pq = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet.json', 'utf8'));
const halt = JSON.parse(readFileSync('evidence/deploy/halt-stack-4663.json', 'utf8'));
const mainnet = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const artifact = JSON.parse(readFileSync('contracts/out/SpecialistRegistry.sol/SpecialistRegistry.json', 'utf8'));
const rpc = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY;
const key = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const pc = createPublicClient({ transport: http(rpc) });
const wc = createWalletClient({ account, transport: http(rpc) });
if (await pc.getChainId() !== 4663) throw new Error('RPC is not Robinhood mainnet');

const BELL = '0xc5d6c1d90c8a87a07e2670b99b1556e818803228';
const USDG = pq.assetDescriptors.USDG.token;
const NVDA_POOL = '0x8a96c3e3ef5a1cca5c4db6254b3451b959877c2595fed7b04c124eb9d3bfffef';
const hybridAuth = halt.reused.hybridAuth;
const registry = halt.reused.assetRegistry === pq.contracts.assetRegistry ? pq.contracts.assetRegistry : pq.contracts.assetRegistry;
const calendar = pq.contracts.calendarRegistry;
const haltRegistry = halt.contracts.haltRegistry;
const auctionRegistry = pq.contracts.auctionRegistry;
const auction = await pc.readContract({ address: auctionRegistry, abi: parseAbi(['function auctionFor(bytes32) view returns (address)']), functionName: 'auctionFor', args: [NVDA_POOL] });
if (/^0x0+$/.test(auction)) throw new Error('the NVDA pool has no auction');

const epochSeconds = Number(arg('epoch-seconds', 7 * 86400));
const day = 86400;
const genesis = Math.floor(Date.now() / 1000 / day) * day; // epoch 0 starts at 00:00 UTC today (the deploy day, never scored)
const params = {
  genesis, epochSeconds, slotSeconds: Number(arg('slot-seconds', 900)), unbondDelay: Number(arg('unbond-delay', 14 * 86400)),
  d1PassBps: 8000, d2PassBps: 9000, minCheckpoints: Number(arg('min-checkpoints', 4)), auctionBandBps: 150, minTickWidth: 600,
  smallSlashBps: 500, largeSlashBps: 2500, rewardShareBps: 1000,
  maxRewardPerEpoch: parseUnits(arg('max-reward', '0.1'), 6), checkpointTip: parseUnits(arg('tip', '0.001'), 6),
  minBondBell: parseUnits(arg('min-bond-bell', '100'), 18), minBondUsdg: parseUnits(arg('min-bond-usdg', '1'), 6),
};
const stocks = [{
  stockId: keccak256(stringToHex('NVDA')), auction, poolId: NVDA_POOL,
  minBuyQuote: parseUnits(arg('min-buy-usdg', '0.02'), 6), minSellBase: parseUnits(arg('min-sell-nvda', '0.0001'), 18), minLiquidity: 100_000_000_000n,
}];
const ASSIGN_ROLE = keccak256(stringToHex('GOVERNANCE'));
const args = [hybridAuth, ASSIGN_ROLE, BELL, USDG, mainnet.poolManager, mainnet.positionManager, calendar, haltRegistry, params, stocks];

const decimals = await pc.readContract({ address: BELL, abi: parseAbi(['function decimals() view returns (uint8)']), functionName: 'decimals' });
const code = await Promise.all([hybridAuth, calendar, haltRegistry, auction, mainnet.poolManager, mainnet.positionManager].map((a) => pc.getCode({ address: a })));
if (code.some((c) => !c || c === '0x')) throw new Error('one of the contracts the registry points at has no code');
console.log(JSON.stringify({ mode: broadcast ? 'BROADCAST' : 'DRY', label, deployer: account.address, bellDecimals: decimals, hybridAuth, assignRole: ASSIGN_ROLE, calendar, haltRegistry, auction, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), stock: { ...stocks[0], minBuyQuote: String(stocks[0].minBuyQuote), minSellBase: String(stocks[0].minSellBase), minLiquidity: String(stocks[0].minLiquidity) } }, null, 2));

const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
const gas = await pc.estimateGas({ account: account.address, data });
const gasPrice = await pc.getGasPrice();
const bal = await pc.getBalance({ address: account.address });
console.log(`deploy gas about ${gas}, cost about ${Number(gas * gasPrice) / 1e18} ETH, deployer holds ${Number(bal) / 1e18} ETH, bytecode ${(artifact.deployedBytecode.object.length - 2) / 2} bytes`);
if (!broadcast) { console.log('dry run: nothing sent'); process.exit(0); }
if (bal < (gas * gasPrice * 13n) / 10n) throw new Error('not enough ETH for the deployment with a margin: nothing sent');
const hash = await wc.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args, gas: (gas * 13n) / 10n });
const r = await pc.waitForTransactionReceipt({ hash });
if (r.status !== 'success') throw new Error(`deployment failed ${hash}`);
console.log(`deployed SpecialistRegistry at ${r.contractAddress}, tx ${hash}, block ${r.blockNumber}`);
writeFileSync(`evidence/deploy/specialist-4663-${label}.json`, `${JSON.stringify({
  chainId: 4663, label, deployedAt: new Date().toISOString(), contract: r.contractAddress, deployTx: hash, block: Number(r.blockNumber), deployer: account.address,
  constructor: {
    hybridAuth, assignRole: 'GOVERNANCE', bell: BELL, usdg: USDG, poolManager: mainnet.poolManager, positionManager: mainnet.positionManager, calendar, haltRegistry,
    params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    stocks: [{ symbol: 'NVDA', stockId: stocks[0].stockId, auction, poolId: NVDA_POOL, minBuyQuote: String(stocks[0].minBuyQuote), minSellBase: String(stocks[0].minSellBase), minLiquidity: String(stocks[0].minLiquidity) }],
  },
  note: label === 'test'
    ? 'Test instance: short epochs and a short unbond delay so the whole lifecycle can be measured in days. Run by a team wallet, labelled as such. No owner, no setters, no proxy.'
    : 'No owner, no setters, no proxy. Epochs are one week, the unbond delay is 14 days.',
}, null, 2)}\n`);
