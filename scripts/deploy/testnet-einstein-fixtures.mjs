#!/usr/bin/env node
/**
 * Robinhood testnet (46630): deploys what the Einstein stack needs that the testnet does not have.
 *   tUSDG and tNVDA (TestToken, name ends in "(BELL test)"), a fixture NVDA price feed (MockChainlinkFeed), and the four
 *   source adapters the mainnet NVDA asset uses (one direct, three session). Writes two evidence files the stack deploy reads.
 *
 *   node scripts/deploy/testnet-einstein-fixtures.mjs            plan only
 *   node scripts/deploy/testnet-einstein-fixtures.mjs --broadcast
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import TokenArtifact from '../../contracts/out/TestToken.sol/TestToken.json' with { type: 'json' };
import FeedArtifact from '../../contracts/out/MockChainlinkFeed.sol/MockChainlinkFeed.json' with { type: 'json' };
import AggregatorArtifact from '../../contracts/out/AggregatorAdapter.sol/AggregatorAdapter.json' with { type: 'json' };
import SessionArtifact from '../../contracts/out/ChainlinkEquitySessionAdapter.sol/ChainlinkEquitySessionAdapter.json' with { type: 'json' };
import { canonicalTokenId } from '../../packages/protocol/src/identity.mjs';
import { buildChainlinkSessionPlan } from './mainnet-chainlink-session-plan.mjs';

const CHAIN_ID = 46630;
const OUT_FIXTURES = 'evidence/deploy/testnet-46630-einstein-fixtures.json';
const OUT_ADAPTERS = 'evidence/deploy/testnet-46630-chainlink-session-adapters.json';
const OUT_INPUTS = 'evidence/deploy/testnet-46630-pq-inputs.json';
const env = { ...process.env };
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const rpc = env.RH_TESTNET_RPC_SECONDARY || env.RH_TESTNET_RPC_PRIMARY;
const pk = env.DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const pc = createPublicClient({ transport: http(rpc) });
const wc = createWalletClient({ account, transport: http(rpc) });
if (await pc.getChainId() !== CHAIN_ID) throw new Error('RPC is not Robinhood testnet 46630');
const broadcast = process.argv.includes('--broadcast');
// The live Uniswap v4 stack on 46630 (docs/CURRENT-STATE.md section 5). evidence/deploy/testnet-46630.json holds predicted addresses that carry no code.
const manifest = { poolManager: '0xc353daf2a37aca96ea468239d973a76020dea059', positionManager: '0x9116ff2aa7a41b60b478ae3ecd8b9b0466a97874', permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3' };
for (const k of ['poolManager', 'positionManager']) { const c = await pc.getBytecode({ address: manifest[k] }); if (!c || c.length <= 2) throw new Error(`${k} has no code`); }
const nvdaPrice = BigInt(process.env.NVDA_FIXTURE_PRICE_E8 ?? '18500000000'); // 185.00 USD, 8 decimals; set before the run from the last real close
const balance = await pc.getBalance({ address: account.address });
console.log(JSON.stringify({ mode: broadcast ? 'BROADCAST' : 'PLAN_ONLY', deployer: account.address, balanceEth: Number(balance) / 1e18, nvdaPriceUsd: Number(nvdaPrice) / 1e8, poolManager: manifest.poolManager }, null, 2));
if (!broadcast) process.exit(0);

const wait = async (hash, what) => { const r = await pc.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw new Error(`${what} failed ${hash}`); return r; };
const deploy = async (what, artifact, args) => { const hash = await wc.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args }); const r = await wait(hash, what); console.log(what, r.contractAddress, hash); return { address: r.contractAddress, tx: hash }; };

const faucet = parseUnits('1000', 18);
const resume = process.env.RESUME_FIXTURES ? JSON.parse(process.env.RESUME_FIXTURES) : null; // {usdg,nvda,feed}: reuse contracts that already landed
const usdg = resume ? { address: resume.usdg, tx: resume.usdgTx } : await deploy('tUSDG', TokenArtifact, ['Test USD Global (BELL test)', 'tUSDG', 6, account.address, parseUnits('1000', 6)]);
const nvda = resume ? { address: resume.nvda, tx: resume.nvdaTx } : await deploy('tNVDA', TokenArtifact, ['Test NVIDIA (BELL test)', 'tNVDA', 18, account.address, faucet]);
const feed = resume ? { address: resume.feed, tx: resume.feedTx } : await deploy('NVDA fixture feed', FeedArtifact, [8, 'NVDA / USD (BELL test fixture)', nvdaPrice]);
const codeOf = async (address) => { for (let i = 0; i < 30; i++) { const c = await pc.getBytecode({ address }); if (c && c.length > 2) return c; await new Promise((r) => setTimeout(r, 2000)); } throw new Error(`no code at ${address}`); };
const feedCode = await codeOf(feed.address);
const tokenCode = await codeOf(nvda.address);
const proxyCodeHash = keccak256(feedCode); const tokenCodeHash = keccak256(tokenCode);
const implementation = feed.address; const implementationCodeHash = proxyCodeHash; // the fixture is its own aggregator
const plan = buildChainlinkSessionPlan({ chainId: CHAIN_ID, token: nvda.address, feed: feed.address, proxyCodeHash, implementation, implementationCodeHash, decimals: 8 });
const tokenId = canonicalTokenId(BigInt(CHAIN_ID), nvda.address);
const adapters = {};
adapters.directAdapter = (await deploy('direct adapter', AggregatorArtifact, [feed.address, proxyCodeHash, implementation, implementationCodeHash, 8, 86400, 2, 1, 0, tokenId])).address;
for (const [scope, key] of [[1, 'regularAdapter'], [2, 'extendedAdapter'], [3, 'overnightAdapter']]) {
  adapters[key] = (await deploy(key, SessionArtifact, [feed.address, proxyCodeHash, implementation, implementationCodeHash, nvda.address, tokenCodeHash, 8, scope, tokenId])).address;
}
// Mint inventory to the deployer so it can seed pools: the faucet is owner-only mint here.
await wait(await wc.writeContract({ address: usdg.address, abi: TokenArtifact.abi, functionName: 'mint', args: [account.address, parseUnits('2000000', 6)] }), 'mint tUSDG');
await wait(await wc.writeContract({ address: nvda.address, abi: TokenArtifact.abi, functionName: 'mint', args: [account.address, parseUnits('20000', 18)] }), 'mint tNVDA');

writeFileSync(OUT_FIXTURES, `${JSON.stringify({ chainId: CHAIN_ID, note: 'Testnet fixtures. Not real assets and not a real price feed.', capturedAt: new Date().toISOString(), deployer: account.address, tUSDG: usdg, tNVDA: nvda, feed: { ...feed, decimals: 8, initialPriceE8: nvdaPrice.toString(), kind: 'MockChainlinkFeed' } }, null, 2)}\n`);
writeFileSync(OUT_ADAPTERS, `${JSON.stringify({ chainId: CHAIN_ID, source: 'BELL testnet fixture feed (MockChainlinkFeed)', capturedAt: new Date().toISOString(), rightsVerified: false, assets: { NVDA: {
  symbol: 'NVDA', stockToken: nvda.address, capabilityMask: 0b11110, ...adapters,
  directWire: plan.directWire, directWireHash: plan.directWireHash,
  regularWire: plan.sessions[1].wire, regularWireHash: plan.sessions[1].wireHash,
  extendedWire: plan.sessions[2].wire, extendedWireHash: plan.sessions[2].wireHash,
  overnightWire: plan.sessions[3].wire, overnightWireHash: plan.sessions[3].wireHash,
  feed: feed.address, proxyCodeHash, tokenCodeHash, implementation, implementationCodeHash } } }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`);
writeFileSync(OUT_INPUTS, `${JSON.stringify({ chainId: CHAIN_ID, deployer: account.address, poolManager: manifest.poolManager, positionManager: manifest.positionManager, permit2: manifest.permit2, feeToken: usdg.address, serviceRecipient: env.TESTNET_SERVICE_RECIPIENT }, null, 2)}\n`);
console.log('fixtures written');
