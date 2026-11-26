#!/usr/bin/env node
/**
 * Deploys UpstairsSettlement on Robinhood Chain mainnet. Dry run by default: it reads the live registries, the feed and the halt registry with the
 * exact values the constructor will get, simulates the deployment, and prints the plan. Sends nothing without --broadcast.
 *
 *   node scripts/upstairs/deploy-upstairs.mjs [--min 1] [--max 50] [--fee-to 0x...] [--broadcast]
 *
 * The contract has no owner and no setters, so the block cap (--max, in USDG) is fixed at deploy. There is no independent audit, so the cap stays small;
 * raising it means a new deployment. Fees go to --fee-to until the buyback contract exists (default: the deployer wallet).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, encodeDeployData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const broadcast = process.argv.includes('--broadcast');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const env = {};
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); } } catch { /* CI */ }
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
const pq = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet.json', 'utf8'));
const halt = JSON.parse(readFileSync('evidence/deploy/halt-stack-4663.json', 'utf8'));
const artifact = JSON.parse(readFileSync('contracts/out/UpstairsSettlement.sol/UpstairsSettlement.json', 'utf8'));
const FEED = '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15'; // Chainlink NVDA/USD, the feed the Evolve run reads
const rpc = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY;
const account = privateKeyToAccount(env.RH_MAINNET_DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.RH_MAINNET_DEPLOYER_PRIVATE_KEY : `0x${env.RH_MAINNET_DEPLOYER_PRIVATE_KEY}`);
const pc = createPublicClient({ transport: http(rpc) });
const wc = createWalletClient({ account, transport: http(rpc) });
if (await pc.getChainId() !== 4663) throw new Error('RPC is not Robinhood mainnet');

const assetRegistry = pq.contracts.assetRegistry; const calendarRegistry = pq.contracts.calendarRegistry; const haltRegistry = halt.contracts?.haltRegistry ?? halt.haltRegistry;
const USDG = pq.assetDescriptors.USDG.token; const NVDA = pq.assetDescriptors.NVDA.token;
const feeTo = arg('fee-to', account.address);
const minNotional = parseUnits(arg('min', '1'), 6); const maxNotional = parseUnits(arg('max', '50'), 6);
const args = [assetRegistry, calendarRegistry, haltRegistry, USDG, feeTo, minNotional, maxNotional, 6 * 3600, [NVDA], [FEED]];

// What the contract will read, read from the live chain first.
const id = await pc.readContract({ address: assetRegistry, abi: parseAbi(['function descriptorIdForToken(address) view returns (bytes32)']), functionName: 'descriptorIdForToken', args: [NVDA] });
if (/^0x0+$/.test(id)) throw new Error('NVDA is not admitted in the AssetRegistry');
const leaf = await pc.readContract({ address: calendarRegistry, abi: parseAbi(['function currentInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']), functionName: 'currentInterval', args: [id] });
const haltPhase = await pc.readContract({ address: haltRegistry, abi: parseAbi(['function phase(bytes32) view returns (uint8)']), functionName: 'phase', args: [id] });
const feedRound = await pc.readContract({ address: FEED, abi: parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)', 'function decimals() view returns (uint8)']), functionName: 'latestRoundData' });
const quoteDecimals = await pc.readContract({ address: USDG, abi: parseAbi(['function decimals() view returns (uint8)']), functionName: 'decimals' });
console.log(JSON.stringify({
  mode: broadcast ? 'BROADCAST' : 'DRY', deployer: account.address, assetRegistry, calendarRegistry, haltRegistry, quoteToken: USDG, quoteDecimals, nvda: NVDA, nvdaAssetId: id,
  calendarNow: { phase: leaf.phase, start: Number(leaf.start), end: Number(leaf.end) }, haltPhase, feed: { price: Number(feedRound[1]) / 1e8, updatedAt: Number(feedRound[3]), ageSeconds: Math.floor(Date.now() / 1000) - Number(feedRound[3]) },
  minUsdg: Number(minNotional) / 1e6, maxUsdg: Number(maxNotional) / 1e6, feeBps: 5, feeTo,
}, null, 2));

const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
const gas = await pc.estimateGas({ account: account.address, data });
const gasPrice = await pc.getGasPrice();
const bal = await pc.getBalance({ address: account.address });
console.log(`deploy gas about ${gas}, cost about ${Number(gas * gasPrice) / 1e18} ETH, deployer holds ${Number(bal) / 1e18} ETH, bytecode ${(artifact.deployedBytecode.object.length - 2) / 2} bytes`);
if (!broadcast) { console.log('dry run: nothing sent'); process.exit(0); }
if (bal < (gas * gasPrice * 18n) / 10n) throw new Error('not enough ETH for the deployment with a margin: nothing sent');
const hash = await wc.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args, gas: (gas * 13n) / 10n });
const r = await pc.waitForTransactionReceipt({ hash });
if (r.status !== 'success') throw new Error(`deployment failed ${hash}`);
console.log(`deployed UpstairsSettlement at ${r.contractAddress}, tx ${hash}, block ${r.blockNumber}`);
writeFileSync('evidence/deploy/upstairs-4663.json', `${JSON.stringify({
  chainId: 4663, deployedAt: new Date().toISOString(), contract: r.contractAddress, deployTx: hash, block: Number(r.blockNumber), deployer: account.address,
  constructor: { assetRegistry, calendarRegistry, haltRegistry, quoteToken: USDG, feeRecipient: feeTo, minNotional: String(minNotional), maxNotional: String(maxNotional), maxFeedAge: 21600, stockTokens: [NVDA], feeds: [FEED] },
  note: 'No owner, no setters, no proxy. The block cap is fixed at deploy because there is no independent audit. Raising it means a new deployment. Version 1 has no TWAP fallback: an asset with no Chainlink feed (ANT) cannot trade here.',
}, null, 2)}\n`);
