#!/usr/bin/env node
/**
 * Deploy the Yahoo source stack on mainnet: verifier, then the direct and stream adapters.
 *
 * The testnet rehearsal scripts hardcode chain 46630 and, for the stream adapters, deploy an
 * `AaplTestnetFacade` because canonical mainnet AAPL has no code on the testnet. On mainnet that
 * facade would be a lie: the adapter must pin the real stock token, so this script refuses to run
 * when the token has no code and never deploys a substitute.
 *
 * The wire hash binds `canonicalTokenId = keccak256(abi.encode(block.chainid, token))`, so the
 * chain id used to build the wire must be the chain the adapter is deployed to.
 *
 *   node scripts/deploy/mainnet-yahoo-stack.mjs            # plan only
 *   node scripts/deploy/mainnet-yahoo-stack.mjs --broadcast
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeDeployData, formatEther, getContractAddress, http, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import YahooVerifierArtifact from '../../contracts/out/YahooSourceVerifier.sol/YahooSourceVerifier.json' with { type: 'json' };
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import { buildMainnetYahooPlan, verifierRuntimeCodeHash } from './mainnet-yahoo-plan.mjs';

const MAINNET_CHAIN_ID = 4663;
const EVIDENCE_PATH = 'evidence/deploy/mainnet-4663-stock-adapters.json';

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv(readFileSync('.env', 'utf8'));
for (const name of ['BELL_MAINNET_SYMBOLS', 'BELL_MAINNET_SYMBOL']) {
  if (process.env[name] !== undefined) env[name] = process.env[name];
}
for (const name of ['BELL_MAINNET_GAS_RESERVE_WEI']) {
  if (process.env[name] !== undefined) env[name] = process.env[name];
}
const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
const pk = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
// Multi-asset: every documented candidate is deployed, not a single BELL_MAINNET_SYMBOL choice.
const SYMBOL_FILTER = (env.BELL_MAINNET_SYMBOLS || env.BELL_MAINNET_SYMBOL || '')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
if (!rpcUrl) throw new Error('RH_MAINNET_RPC_PRIMARY is required');
if (!pk) throw new Error('RH_MAINNET_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required');

const broadcast = process.argv.includes('--broadcast');
const authorizeSpend = process.argv.includes('--i-authorize-spend');
if (broadcast && !authorizeSpend) throw new Error('Yahoo deployment requires --i-authorize-spend in addition to --broadcast');
const nonceOffsetArg = process.argv.find((arg) => arg.startsWith('--nonce-offset='))?.slice('--nonce-offset='.length);
const nonceOffset = nonceOffsetArg === undefined ? 0n : BigInt(nonceOffsetArg);
if (nonceOffset < 0n) throw new Error('--nonce-offset must be a non-negative integer');
if (broadcast && nonceOffset !== 0n) throw new Error('--nonce-offset is plan-only; broadcast uses the live deployer nonce');

const candidates = JSON.parse(readFileSync('config/assets/candidates.mainnet.json', 'utf8'));
const allAssets = candidates.assets ?? [];
const selectedAssets = SYMBOL_FILTER.length
  ? allAssets.filter((a) => SYMBOL_FILTER.includes(a.symbol))
  : allAssets;
if (selectedAssets.length === 0) throw new Error('no candidate assets selected; check config/assets/candidates.mainnet.json');
for (const asset of selectedAssets) {
  if (!asset.token || !/^0x[0-9a-fA-F]{40}$/.test(asset.token)) throw new Error(`${asset.symbol} has no reviewed mainnet token address`);
}

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Wrong chain ${chainId}; expected ${MAINNET_CHAIN_ID}`);

// Per-asset validation: every selected stock token must have code on mainnet and a clean symbol.
const tokenSymbols = {};
for (const asset of selectedAssets) {
  const tokenCode = await publicClient.getBytecode({ address: asset.token });
  if (!tokenCode || tokenCode === '0x') {
    throw new Error(`${asset.symbol} token ${asset.token} has no code on mainnet; refusing to substitute a facade`);
  }
  const tokenSymbol = await publicClient
    .readContract({ address: asset.token, abi: [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }], functionName: 'symbol' })
    .catch(() => null);
  if (/facade|testnet|rehearsal|fixture|mock/i.test(tokenSymbol ?? '')) {
    throw new Error(`${asset.symbol} token symbol "${tokenSymbol}" looks like a rehearsal fixture`);
  }
  tokenSymbols[asset.symbol] = tokenSymbol;
}

const reporter = env.YAHOO_REPORTER_ADDRESS;
if (!reporter || !/^0x[0-9a-fA-F]{40}$/.test(reporter)) throw new Error('YAHOO_REPORTER_ADDRESS must be a valid address');
const verifierCodeHash = verifierRuntimeCodeHash({
  deployedBytecode: YahooVerifierArtifact.deployedBytecode.object,
  immutableReferences: YahooVerifierArtifact.deployedBytecode.immutableReferences,
  reporter,
});

// One verifier for the whole deployment (shares the reporter), then one wire set per asset.
// The verifier address is the deployer's CREATE address at the current nonce; building every
// wire against that exact address keeps plan-only hashes equal to post-broadcast hashes. The
// existing YAHOO_SOURCE_VERIFIER_ADDRESS may be the testnet verifier, so this flow never
// implicitly reuses it.
const liveDeployerNonce = await publicClient.getTransactionCount({ address: account.address });
const deployerNonce = BigInt(liveDeployerNonce) + nonceOffset;
const plans = selectedAssets.map((asset) => ({
  asset,
  plan: buildMainnetYahooPlan({
    deployer: account.address,
    deployerNonce,
    token: asset.token,
    verifierCodeHash,
    symbol: asset.symbol,
    reporter,
  }),
}));
if (broadcast && nonceOffset !== 0n) throw new Error('--nonce-offset is plan-only; broadcast uses live nonce');
const adapterAddressByKey = new Map();
let nextAdapterNonce = deployerNonce + 1n;
for (const { asset, plan } of plans) {
  for (const { key } of plan.wires) {
    adapterAddressByKey.set(`${asset.symbol}:${key}`, getContractAddress({ from: account.address, nonce: nextAdapterNonce }));
    nextAdapterNonce += 1n;
  }
}

const deploySpecs = [
  { label: 'YahooSourceVerifier', abi: YahooVerifierArtifact.abi, bytecode: YahooVerifierArtifact.bytecode.object, args: [reporter] },
  ...plans.flatMap(({ asset, plan }) => plan.wires.map(({ scope, wire, sourceConfigHash }) => ({
    label: `${asset.symbol}:${scope}`,
    abi: YahooAdapterArtifact.abi,
    bytecode: YahooAdapterArtifact.bytecode.object,
    args: [plan.verifierAddress, sourceConfigHash, scope === 0 ? `0x${'00'.repeat(32)}` : wire.feedId, scope, scope === 0, scope === 0 ? '0x0000000000000000000000000000000000000000' : asset.token],
  }))),
];
const gasPrice = await publicClient.getGasPrice();
const deploymentEstimates = [];
for (const spec of deploySpecs) {
  if (spec.label !== 'YahooSourceVerifier') {
    deploymentEstimates.push({ label: spec.label, gas: null, cost: null, estimateStatus: 'requires verifier deployed at predicted address' });
    continue;
  }
      const data = encodeDeployData({ abi: spec.abi, bytecode: spec.bytecode, args: spec.args });
  const gas = spec.label === 'YahooSourceVerifier' ? await publicClient.estimateGas({ account: account.address, data }) : null;
  if (gas === null) {
    deploymentEstimates.push({ label: spec.label, gas: null, cost: null, estimateStatus: 'verifier runtime required; estimate after verifier broadcast' });
    continue;
  }
  deploymentEstimates.push({ label: spec.label, gas, cost: gas * gasPrice, estimateStatus: 'estimated' });
}
const knownEstimatedGasWei = deploymentEstimates.reduce((sum, item) => sum + (item.cost ?? 0n), 0n);
const deployerBalance = await publicClient.getBalance({ address: account.address });
const retainedGasReserve = BigInt(env.BELL_MAINNET_GAS_RESERVE_WEI || 5_000_000_000_000_000n);
if (broadcast && deployerBalance < retainedGasReserve) throw new Error(`deployer balance ${formatEther(deployerBalance)} ETH is below retained reserve ${formatEther(retainedGasReserve)} ETH before Yahoo deployment`);
const predictedAddresses = plans.flatMap(({ plan }) => [
  plan.verifierAddress,
  ...plan.wires.map(({ key }) => adapterAddressByKey.get(`${plan.symbol}:${key}`)).filter(Boolean),
]);
for (const address of new Set(predictedAddresses)) {
  const code = await publicClient.getBytecode({ address });
  if (code && code !== '0x') throw new Error(`predicted Yahoo CREATE address ${address} already has code; reconcile live nonce and deployment evidence before continuing`);
}

if (!broadcast) {
  console.log(JSON.stringify({
    mode: 'PLAN_ONLY',
    chainId,
    deployer: account.address,
    liveDeployerNonce,
    nonceOffset: nonceOffset.toString(),
    plannedVerifierNonce: deployerNonce.toString(),
    symbols: selectedAssets.map((a) => a.symbol),
    reporter,
    verifierAddress: plans[0].plan.verifierAddress,
    verifierAddressSource: plans[0].plan.verifierAddressSource,
    verifierCodeHash,
    deploymentGas: deploymentEstimates.map(({ label, gas, cost, estimateStatus }) => ({ label, gas: gas?.toString() ?? null, costWei: cost?.toString() ?? null, estimateStatus })),
    knownEstimatedGasWei: knownEstimatedGasWei.toString(),
    note: 'Adapter gas is estimated after verifier deployment because constructors require verifier code at the predicted address.',
    deployerBalanceWei: deployerBalance.toString(),
    retainedGasReserveWei: retainedGasReserve.toString(),
    assets: plans.map(({ asset, plan }) => ({
      symbol: asset.symbol,
      token: asset.token,
      tokenSymbol: tokenSymbols[asset.symbol],
      scopes: plan.wires.map(({ scope, label, wire, sourceConfigHash }) => ({
        scope,
        label,
        feedId: wire.feedId,
        sourceConfigHash,
      })),
    })),
  }, null, 2));
  console.log('Plan only. Re-run with --broadcast --i-authorize-spend to deploy the verifier and all selected asset adapter sets.');
  process.exit(0);
}

const verifierDeployGas = deploymentEstimates.find((item) => item.label === 'YahooSourceVerifier')?.gas;
if (verifierDeployGas !== undefined && verifierDeployGas !== null) {
  const verifierDeploymentCost = verifierDeployGas * gasPrice;
  if (deployerBalance < verifierDeploymentCost + retainedGasReserve) {
    throw new Error(`deployer cannot fund Yahoo verifier while preserving reserve: balance=${formatEther(deployerBalance)} verifier=${formatEther(verifierDeploymentCost)} reserve=${formatEther(retainedGasReserve)} ETH`);
  }
}

// 1. One verifier for all assets, pinned to the reporter that will sign quotes. It must land at
// the predicted CREATE address, otherwise every planned SourceWire hash points at the wrong verifier.
console.log(`Deploying YahooSourceVerifier(reporter=${reporter})`);
const verifierHash = await walletClient.deployContract({
  abi: YahooVerifierArtifact.abi,
  bytecode: YahooVerifierArtifact.bytecode.object,
  args: [reporter],
});
const verifierReceipt = await publicClient.waitForTransactionReceipt({ hash: verifierHash });
if (verifierReceipt.status !== 'success') throw new Error('verifier deploy reverted');
const verifier = verifierReceipt.contractAddress;
if (verifier.toLowerCase() !== plans[0].plan.verifierAddress.toLowerCase()) {
  throw new Error(`deployed verifier ${verifier} != predicted ${plans[0].plan.verifierAddress}; refusing adapter deploy`);
}
const verifierOnchainCodeHash = keccak256(await publicClient.getBytecode({ address: verifier }));
if (verifierOnchainCodeHash !== verifierCodeHash) {
  throw new Error(`deployed verifier code hash ${verifierOnchainCodeHash} != artifact ${verifierCodeHash}`);
}
console.log(`  verifier: ${verifier} (tx ${verifierHash})`);

const adapterGasPrice = await publicClient.getGasPrice();
let remainingAdapterEstimate = 0n;
for (const { asset, plan } of plans) {
  for (const { scope, wire, sourceConfigHash } of plan.wires) {
    const adapterData = encodeDeployData({
      abi: YahooAdapterArtifact.abi,
      bytecode: YahooAdapterArtifact.bytecode.object,
      args: [verifier, sourceConfigHash, scope === 0 ? `0x${'00'.repeat(32)}` : wire.feedId, scope, scope === 0, scope === 0 ? '0x0000000000000000000000000000000000000000' : asset.token],
    });
    const gas = await publicClient.estimateGas({ account: account.address, data: adapterData });
    remainingAdapterEstimate += gas * adapterGasPrice;
  }
}
const postVerifierBalance = await publicClient.getBalance({ address: account.address });
if (postVerifierBalance < remainingAdapterEstimate + retainedGasReserve) {
  throw new Error(`post-verifier balance ${formatEther(postVerifierBalance)} ETH cannot fund remaining adapters ${formatEther(remainingAdapterEstimate)} + reserve ${formatEther(retainedGasReserve)} ETH; halt before adapter broadcasts`);
}
// 2. Adapters per asset, each pinned to its own token and wire hash.
const deployedBySymbol = {};
for (const { asset, plan } of plans) {
  const deployed = {};
  for (const { scope, key, label, wire, sourceConfigHash } of plan.wires) {
    const direct = scope === 0;
    console.log(`Deploying ${asset.symbol} ${label} adapter (scope ${scope})`);
    const hash = await walletClient.deployContract({
      abi: YahooAdapterArtifact.abi,
      bytecode: YahooAdapterArtifact.bytecode.object,
      args: [
        verifier,
        sourceConfigHash,
        direct ? `0x${'00'.repeat(32)}` : wire.feedId,
        scope,
        direct,
        direct ? '0x0000000000000000000000000000000000000000' : asset.token,
      ],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const expectedAdapter = adapterAddressByKey.get(`${asset.symbol}:${key}`);
    if (receipt.status !== 'success' || receipt.contractAddress?.toLowerCase() !== expectedAdapter?.toLowerCase()) {
      throw new Error(`${asset.symbol} ${label}: adapter deployed at ${receipt.contractAddress}, expected ${expectedAdapter}; refuse further deployments`);
    }

    const abi = YahooAdapterArtifact.abi;
    const [onchainWire, onchainFeed, onchainVerifier, onchainToken] = await Promise.all([
      publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'sourceConfigHash' }),
      publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'feedId' }),
      publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'verifier' }),
      publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'stockToken' }),
    ]);
    if (onchainWire !== sourceConfigHash) throw new Error(`${asset.symbol} ${label}: sourceConfigHash mismatch`);
    if (onchainFeed !== wire.feedId) throw new Error(`${asset.symbol} ${label}: feedId mismatch`);
    if (onchainVerifier.toLowerCase() !== verifier.toLowerCase()) throw new Error(`${asset.symbol} ${label}: verifier mismatch`);
    if (!direct && onchainToken.toLowerCase() !== asset.token.toLowerCase()) throw new Error(`${asset.symbol} ${label}: stockToken mismatch`);

    const adapterCodeHash = keccak256(await publicClient.getBytecode({ address: receipt.contractAddress }));
    const activeEvidence = existsSync(EVIDENCE_PATH) ? JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) : {};
    const activeAssets = { ...(activeEvidence.assets ?? {}), [asset.symbol]: {
      symbol: asset.symbol,
      stockToken: asset.token,
      capabilityMask: 0b1110,
      ...(activeEvidence.assets?.[asset.symbol] ?? {}),
      [key]: wire,
      [`${key}Hash`]: sourceConfigHash,
      [`${label}Adapter`]: receipt.contractAddress,
      [`${label}CodeHash`]: adapterCodeHash,
      transactionHash: hash,
      blockNumber: Number(receipt.blockNumber),
    } };
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify({ ...activeEvidence, chainId, verifier, verifierCodeHash, reporter, assets: activeAssets, deployedAt: new Date().toISOString(), rightsVerified: false }, null, 2)}\n`);

    deployed[key] = wire;
    deployed[`${key}Hash`] = sourceConfigHash;
    deployed[`${label}Adapter`] = receipt.contractAddress;
    console.log(`  ${asset.symbol} ${label}: ${receipt.contractAddress} (tx ${hash})`);
  }
  deployedBySymbol[asset.symbol] = deployed;
}

// Multi-asset evidence: `assets` keyed by symbol is the canonical read for admission/keeper tooling.
const assetsEvidence = {};
for (const asset of selectedAssets) {
  const deployed = deployedBySymbol[asset.symbol];
  assetsEvidence[asset.symbol] = {
    symbol: asset.symbol,
    stockToken: asset.token,
    capabilityMask: 0b1110, // PRE | REGULAR | POST per the brief's session scope
    directAdapter: deployed.directAdapter,
    regularAdapter: deployed.regularAdapter,
    extendedAdapter: deployed.extendedAdapter,
    directWire: deployed.directWire,
    regularWire: deployed.regularWire,
    extendedWire: deployed.extendedWire,
    directWireHash: deployed.directWireHash,
    regularWireHash: deployed.regularWireHash,
    extendedWireHash: deployed.extendedWireHash,
  };
}
const evidence = {
  chainId,
  verifier,
  verifierCodeHash,
  reporter,
  assets: assetsEvidence,
  deployedAt: new Date().toISOString(),
  rightsVerified: false,
  note: 'Adapters prove the source wiring is pinned on chain. They do not prove the underlying quote rights.',
};
const existing = existsSync(EVIDENCE_PATH) ? JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) : {};
writeFileSync(EVIDENCE_PATH, `${JSON.stringify({ ...existing, ...evidence }, null, 2)}\n`);
console.log(`Wrote ${EVIDENCE_PATH}`);
