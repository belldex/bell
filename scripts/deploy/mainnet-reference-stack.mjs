#!/usr/bin/env node
/** Deploy per-token Chainlink onchain references used by PRICE_GUARDED. Defaults to plan-only. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeDeployData, formatEther, getContractAddress, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import ReferenceArtifact from '../../contracts/out/ChainlinkTokenReferenceAdapter.sol/ChainlinkTokenReferenceAdapter.json' with { type: 'json' };
import { buildMainnetReferenceSpecs } from './mainnet-reference-config.mjs';

const CHAIN_ID = 4663;
const OUTPUT = 'evidence/deploy/mainnet-4663-reference-adapters.json';
const ZERO = '0x0000000000000000000000000000000000000000';

function envFile() {
  const env = { ...process.env };
  for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = envFile();
const rpc = env.RH_MAINNET_RPC_PRIMARY;
const key = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!rpc || !key) throw new Error('RH_MAINNET_RPC_PRIMARY and RH_MAINNET_DEPLOYER_PRIVATE_KEY are required');
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const pub = createPublicClient({ transport: http(rpc) });
const wallet = createWalletClient({ account, transport: http(rpc) });
if (await pub.getChainId() !== CHAIN_ID) throw new Error('RPC is not Robinhood mainnet 4663');

const candidates = JSON.parse(readFileSync('config/assets/candidates.mainnet.json', 'utf8'));
const manifest = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const specs = buildMainnetReferenceSpecs({
  candidates: candidates.assets,
  quoteFeeds: candidates.quoteFeeds,
  weth: manifest.weth,
  usdg: manifest.feeToken,
});
const stockSpecs = specs.stocks.map((s) => ({ ...s, symbol: `${s.symbol}/USD` }));
const counterSpecs = [
  { ...specs.counterassets.WETH, symbol: 'WETH/USD', stockToken: ZERO },
  { ...specs.counterassets.USDG, symbol: 'USDG/USD', stockToken: ZERO },
];
const allSpecs = [...stockSpecs, ...counterSpecs];

// Verify all feed endpoints and current rounds before constructing deployments.
const FEED_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
]);
const block = await pub.getBlock();
const now = Number(block.timestamp);
const feedChecks = [];
for (const spec of allSpecs) {
  const [code, decimals, description, round] = await Promise.all([
    pub.getBytecode({ address: spec.feed }),
    pub.readContract({ address: spec.feed, abi: FEED_ABI, functionName: 'decimals' }),
    pub.readContract({ address: spec.feed, abi: FEED_ABI, functionName: 'description' }),
    pub.readContract({ address: spec.feed, abi: FEED_ABI, functionName: 'latestRoundData' }),
  ]);
  if (!code || code === '0x') throw new Error(`${spec.symbol}: feed has no code: ${spec.feed}`);
  if (Number(decimals) !== spec.decimals) throw new Error(`${spec.symbol}: decimals mismatch candidate=${spec.decimals}, onchain=${decimals}`);
  const age = now - Number(round[3]);
  if (round[0] === 0n || round[4] < round[0] || round[1] <= 0n || age < 0 || age > spec.heartbeatSeconds) {
    throw new Error(`${spec.symbol}: feed round not valid/fresh (age=${age}s heartbeat=${spec.heartbeatSeconds}s)`);
  }
  feedChecks.push({ symbol: spec.symbol, feed: spec.feed, description, decimals: Number(decimals), answer: round[1].toString(), updatedAt: Number(round[3]), ageSeconds: age, codeBytes: (code.length - 2) / 2 });
}

const liveNonce = await pub.getTransactionCount({ address: account.address });
const gasPrice = await pub.getGasPrice();
const estimates = [];
for (let i = 0; i < allSpecs.length; i += 1) {
  const spec = allSpecs[i];
  const stockToken = spec.stockToken ?? ZERO;
  const args = [spec.feed, spec.heartbeatSeconds, spec.decimals, spec.symbol, stockToken];
  const data = encodeDeployData({ abi: ReferenceArtifact.abi, bytecode: ReferenceArtifact.bytecode.object, args });
  const gas = await pub.estimateGas({ account: account.address, data });
  estimates.push({ symbol: spec.symbol, nonce: liveNonce + i, predictedAddress: getContractAddress({ from: account.address, nonce: BigInt(liveNonce + i) }), gas });
}

for (let i = 0; i < estimates.length; i += 1) {
  const code = await pub.getBytecode({ address: estimates[i].predictedAddress });
  if (code && code !== '0x') {
    throw new Error(`predicted adapter address ${estimates[i].predictedAddress} for ${estimates[i].symbol} already has code; reconcile nonce/evidence before planning deploys`);
  }
}

const totalGas = estimates.reduce((s, e) => s + e.gas, 0n);
const estimatedCost = totalGas * gasPrice;
const balance = await pub.getBalance({ address: account.address });
const reserve = BigInt(env.BELL_MAINNET_GAS_RESERVE_WEI || 5_000_000_000_000_000n);
const broadcast = process.argv.includes('--broadcast');

if (!broadcast) {
  console.log(JSON.stringify({ mode: 'PLAN_ONLY', chainId: CHAIN_ID, block: Number(block.number), deployer: account.address, liveNonce, balanceEth: formatEther(balance), feedChecks, deployments: estimates.map(e => ({ symbol: e.symbol, nonce: e.nonce, predictedAddress: e.predictedAddress, gas: e.gas.toString() })), totalGas: totalGas.toString(), estimatedCostEth: formatEther(estimatedCost), estimatedCostPlusReserveEth: formatEther(estimatedCost + reserve) }, null, 2));
  console.log('No transactions sent. Add --broadcast to deploy after funding enough gas.');
  process.exit(0);
}

if (balance < estimatedCost + reserve) throw new Error(`insufficient ETH: need estimated ${formatEther(estimatedCost)} + reserve ${formatEther(reserve)}, have ${formatEther(balance)}`);

const predictedCodes = await Promise.all(estimates.map((estimate) => pub.getBytecode({ address: estimate.predictedAddress })));
if (predictedCodes.some((code) => code && code !== '0x')) {
  throw new Error('some predicted adapter CREATE addresses already have code; refusing unsafe nonce/address reuse. Reconcile deployer nonce and evidence before broadcasting.');
}

const deployed = {};
if (broadcast) {
  for (const spec of allSpecs) {
    const expected = estimates.find((estimate) => estimate.symbol === spec.symbol);
    const hash = await wallet.deployContract({ abi: ReferenceArtifact.abi, bytecode: ReferenceArtifact.bytecode.object, args: [spec.feed, spec.heartbeatSeconds, spec.decimals, spec.symbol, spec.stockToken ?? ZERO] });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || receipt.contractAddress?.toLowerCase() !== expected.predictedAddress.toLowerCase()) {
      throw new Error(`${spec.symbol} deployment did not match its predicted address: ${hash}`);
    }
    const [onchainFeed, onchainHash] = await Promise.all([
      pub.readContract({ address: receipt.contractAddress, abi: ReferenceArtifact.abi, functionName: 'feed' }),
      pub.readContract({ address: receipt.contractAddress, abi: ReferenceArtifact.abi, functionName: 'sourceConfigHash' }),
    ]);
    if (onchainFeed.toLowerCase() !== spec.feed.toLowerCase()) throw new Error(`${spec.symbol}: deployed feed binding mismatch`);
    deployed[spec.symbol] = { ...spec, adapter: receipt.contractAddress, sourceConfigHash: onchainHash, transactionHash: hash, blockNumber: Number(receipt.blockNumber), addressLink: `https://robinhoodchain.blockscout.com/address/${receipt.contractAddress}`, transactionLink: `https://robinhoodchain.blockscout.com/tx/${hash}` };
  }
}
writeFileSync(OUTPUT, `${JSON.stringify({ chainId: CHAIN_ID, verifier: 'Chainlink AggregatorV3 read-only', deployedAt: new Date().toISOString(), feeds: deployed, adapters: deployed }, null, 2)}\n`);
console.log(`Wrote ${OUTPUT}`);
