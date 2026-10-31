#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeDeployData, getContractAddress, http, keccak256, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import AggregatorArtifact from '../../contracts/out/AggregatorAdapter.sol/AggregatorAdapter.json' with { type: 'json' };
import SessionArtifact from '../../contracts/out/ChainlinkEquitySessionAdapter.sol/ChainlinkEquitySessionAdapter.json' with { type: 'json' };
import { canonicalTokenId } from '../../packages/protocol/src/identity.mjs';
import { buildChainlinkSessionPlan } from './mainnet-chainlink-session-plan.mjs';

const CHAIN_ID = 4663;
const OUTPUT = 'evidence/deploy/mainnet-4663-chainlink-session-adapters.json';
const env = { ...process.env };
const envPath = process.env.BELL_ENV_FILE || '.env';
if (existsSync(envPath)) for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const rpc = env.RH_MAINNET_RPC_PRIMARY;
const privateKey = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!rpc || !privateKey) throw new Error('Mainnet RPC and deployer key are required');
const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
const publicClient = createPublicClient({ transport: http(rpc) });
const walletClient = createWalletClient({ account, transport: http(rpc) });
if (await publicClient.getChainId() !== CHAIN_ID) throw new Error('RPC is not Robinhood Chain mainnet');

const candidates = JSON.parse(readFileSync('config/assets/candidates.mainnet.json', 'utf8'));
const specs = candidates.assets.map((candidate) => ({
  symbol: candidate.symbol,
  stockToken: candidate.token,
  feed: candidate.directAdjustedTokenUsd.proxy,
  decimals: candidate.directAdjustedTokenUsd.decimals,
  heartbeatSeconds: candidate.directAdjustedTokenUsd.heartbeatSeconds,
}));
const feedAbi = parseAbi(['function decimals() view returns (uint8)', 'function aggregator() view returns (address)', 'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
const block = await publicClient.getBlock();
const broadcast = process.argv.includes('--broadcast');
if (broadcast && !process.argv.includes('--i-authorize-spend')) throw new Error('Broadcast requires --i-authorize-spend');
const estimatedSpecs = [];
for (const asset of specs) {
  const [proxyCode, tokenCode, decimals, implementation, round] = await Promise.all([
    publicClient.getBytecode({ address: asset.feed }),
    publicClient.getBytecode({ address: asset.stockToken }),
    publicClient.readContract({ address: asset.feed, abi: feedAbi, functionName: 'decimals' }),
    publicClient.readContract({ address: asset.feed, abi: feedAbi, functionName: 'aggregator' }),
    publicClient.readContract({ address: asset.feed, abi: feedAbi, functionName: 'latestRoundData' }),
  ]);
  const implementationCode = await publicClient.getBytecode({ address: implementation });
  if (!proxyCode || !tokenCode || !implementationCode || Number(decimals) !== asset.decimals || round[0] === 0n || round[1] <= 0n || round[4] < round[0]) throw new Error(`${asset.symbol}: feed/token identity/round validation failed`);
  const nowAge = Number(block.timestamp - round[3]);
  const proxyCodeHash = keccak256(proxyCode);
  const tokenCodeHash = keccak256(tokenCode);
  const implementationCodeHash = keccak256(implementationCode);
  const plan = buildChainlinkSessionPlan({ chainId: CHAIN_ID, token: asset.stockToken, feed: asset.feed, proxyCodeHash, implementation, implementationCodeHash, decimals: asset.decimals });
  const tokenId = canonicalTokenId(BigInt(CHAIN_ID), asset.stockToken);
  const directArgs = [asset.feed, proxyCodeHash, implementation, implementationCodeHash, asset.decimals, asset.heartbeatSeconds, 2, 1, 0, tokenId];
  const specsToDeploy = [
    { key: 'directAdapter', artifact: AggregatorArtifact, args: directArgs },
    ...Object.entries(plan.sessions).map(([scope]) => ({ key: scope === '1' ? 'regularAdapter' : scope === '2' ? 'extendedAdapter' : 'overnightAdapter', artifact: SessionArtifact, args: [asset.feed, proxyCodeHash, implementation, implementationCodeHash, asset.stockToken, tokenCodeHash, asset.decimals, Number(scope), tokenId] })),
  ];
  estimatedSpecs.push({ asset, plan, specsToDeploy, roundAgeSeconds: nowAge, proxyCodeHash, tokenCodeHash, implementation, implementationCodeHash });
}

let estimatedGas = 0n;
for (const row of estimatedSpecs) for (const spec of row.specsToDeploy) {
  const initCode = encodeDeployData({ abi: spec.artifact.abi, bytecode: spec.artifact.bytecode.object, args: spec.args });
  estimatedGas += await publicClient.estimateGas({ account: account.address, data: initCode });
}
const gasPrice = await publicClient.getGasPrice();
const deploymentCost = estimatedGas * gasPrice * 125n / 100n;
const balance = await publicClient.getBalance({ address: account.address });
const reserve = BigInt(env.BELL_MAINNET_GAS_RESERVE_WEI || 5_000_000_000_000_000n);
if (broadcast && balance < deploymentCost + reserve) throw new Error(`Insufficient deployer ETH: estimated adapters cost ${deploymentCost} wei including 25% gas buffer; retained reserve ${reserve} wei`);

if (!broadcast) {
  console.log(JSON.stringify({ chainId: CHAIN_ID, deployer: account.address, mode: 'PLAN_ONLY', estimatedGas: estimatedGas.toString(), gasPriceWei: gasPrice.toString(), estimatedCostWith25PercentBufferWei: deploymentCost.toString(), deployerBalanceWei: balance.toString(), retainedReserveWei: reserve.toString(), sufficient: balance >= deploymentCost + reserve, assets: estimatedSpecs.map(({ asset, roundAgeSeconds, proxyCodeHash, tokenCodeHash, implementation, implementationCodeHash, plan }) => ({ symbol: asset.symbol, feed: asset.feed, token: asset.stockToken, roundAgeSeconds, proxyCodeHash, tokenCodeHash, implementation, implementationCodeHash, directWireHash: plan.directWireHash, sessionWireHashes: Object.fromEntries(Object.entries(plan.sessions).map(([scope, item]) => [scope, item.wireHash])) })) }, null, 2));
  process.exit(0);
}

const nonce = await publicClient.getTransactionCount({ address: account.address });
const evidence = { chainId: CHAIN_ID, source: 'Chainlink Robinhood 24/5 onchain AggregatorV3', capturedAt: new Date().toISOString(), rightsVerified: false, assets: {} };
let offset = 0;
for (const row of estimatedSpecs) {
  const { asset, plan, specsToDeploy } = row;
  const tokenId = canonicalTokenId(BigInt(CHAIN_ID), asset.stockToken);
  const deployed = {};
  for (const spec of specsToDeploy) {
    const predicted = getContractAddress({ from: account.address, nonce: BigInt(nonce + offset) });
    const hash = await walletClient.deployContract({ abi: spec.artifact.abi, bytecode: spec.artifact.bytecode.object, args: spec.args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || receipt.contractAddress?.toLowerCase() !== predicted.toLowerCase()) throw new Error(`${asset.symbol} ${spec.key} deployment failed or nonce drifted`);
    deployed[spec.key] = receipt.contractAddress;
    offset += 1;
  }
  evidence.assets[asset.symbol] = {
    symbol: asset.symbol, stockToken: asset.stockToken, capabilityMask: 0b11110,
    ...deployed, directWire: plan.directWire, directWireHash: plan.directWireHash,
    regularWire: plan.sessions[1].wire, regularWireHash: plan.sessions[1].wireHash,
    extendedWire: plan.sessions[2].wire, extendedWireHash: plan.sessions[2].wireHash,
    overnightWire: plan.sessions[3].wire, overnightWireHash: plan.sessions[3].wireHash,
    feed: asset.feed, proxyCodeHash: row.proxyCodeHash, tokenCodeHash: row.tokenCodeHash, implementation: row.implementation,
    implementationCodeHash: row.implementationCodeHash, roundAgeSecondsAtPlan: row.roundAgeSeconds,
  };
}
writeFileSync(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Deployed ${Object.keys(evidence.assets).length} Chainlink session adapter sets; evidence written to ${OUTPUT}`);
