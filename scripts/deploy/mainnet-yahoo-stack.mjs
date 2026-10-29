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
import { createPublicClient, createWalletClient, http, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import YahooVerifierArtifact from '../../contracts/out/YahooSourceVerifier.sol/YahooSourceVerifier.json' with { type: 'json' };
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import { buildMainnetYahooPlan } from './mainnet-yahoo-plan.mjs';

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
const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
const pk = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
const symbol = (env.BELL_MAINNET_SYMBOL || 'AAPL').toUpperCase();
if (!rpcUrl) throw new Error('RH_MAINNET_RPC_PRIMARY is required');
if (!pk) throw new Error('RH_MAINNET_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required');

const broadcast = process.argv.includes('--broadcast');
const nonceOffsetArg = process.argv.find((arg) => arg.startsWith('--nonce-offset='))?.slice('--nonce-offset='.length);
const nonceOffset = nonceOffsetArg === undefined ? 0n : BigInt(nonceOffsetArg);
if (nonceOffset < 0n) throw new Error('--nonce-offset must be a non-negative integer');
if (broadcast && nonceOffset !== 0n) throw new Error('--nonce-offset is plan-only; broadcast uses the live deployer nonce');

const candidates = JSON.parse(readFileSync('config/assets/candidates.mainnet.json', 'utf8'));
const asset = candidates.assets?.find((a) => a.symbol === symbol);
if (!asset) throw new Error(`${symbol} is not in config/assets/candidates.mainnet.json`);
if (!asset.token || !/^0x[0-9a-fA-F]{40}$/.test(asset.token)) throw new Error(`${symbol} has no reviewed mainnet token address`);

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Wrong chain ${chainId}; expected ${MAINNET_CHAIN_ID}`);

const tokenCode = await publicClient.getBytecode({ address: asset.token });
if (!tokenCode || tokenCode === '0x') {
  throw new Error(`${symbol} token ${asset.token} has no code on mainnet; refusing to substitute a facade`);
}
const tokenSymbol = await publicClient
  .readContract({ address: asset.token, abi: [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }], functionName: 'symbol' })
  .catch(() => null);
if (/facade|testnet|rehearsal|fixture|mock/i.test(tokenSymbol ?? '')) {
  throw new Error(`${symbol} token symbol "${tokenSymbol}" looks like a rehearsal fixture`);
}

const verifierCodeHash = keccak256(YahooVerifierArtifact.deployedBytecode.object);
const reporter = env.YAHOO_REPORTER_ADDRESS;
if (!reporter || !/^0x[0-9a-fA-F]{40}$/.test(reporter)) throw new Error('YAHOO_REPORTER_ADDRESS must be a valid address');

// The verifier address is the deployer's CREATE address at the current nonce. Build the wires
// against that exact address so plan-only hashes equal the hashes used after broadcast. The
// existing YAHOO_SOURCE_VERIFIER_ADDRESS may be the testnet verifier, so this mainnet flow never
// implicitly reuses it.
const liveDeployerNonce = await publicClient.getTransactionCount({ address: account.address });
const deployerNonce = BigInt(liveDeployerNonce) + nonceOffset;
const plan = buildMainnetYahooPlan({
  deployer: account.address,
  deployerNonce,
  token: asset.token,
  verifierCodeHash,
  symbol,
  reporter,
});

if (!broadcast) {
  console.log(JSON.stringify({
    mode: 'PLAN_ONLY',
    chainId,
    deployer: account.address,
    liveDeployerNonce,
    nonceOffset: nonceOffset.toString(),
    plannedVerifierNonce: deployerNonce.toString(),
    symbol,
    token: asset.token,
    tokenSymbol,
    reporter,
    verifierAddress: plan.verifierAddress,
    verifierAddressSource: plan.verifierAddressSource,
    verifierCodeHash,
    scopes: plan.wires.map(({ scope, label, wire, sourceConfigHash }) => ({
      scope,
      label,
      feedId: wire.feedId,
      sourceConfigHash,
    })),
  }, null, 2));
  console.log('Re-run with --broadcast to deploy the verifier at the predicted address, then its adapters.');
  process.exit(0);
}

// 1. Verifier, pinned to the reporter that will sign quotes. It must land at the predicted CREATE
// address, otherwise all planned SourceWire hashes would point at the wrong verifier.
console.log(`Deploying YahooSourceVerifier(reporter=${reporter})`);
const verifierHash = await walletClient.deployContract({
  abi: YahooVerifierArtifact.abi,
  bytecode: YahooVerifierArtifact.bytecode.object,
  args: [reporter],
});
const verifierReceipt = await publicClient.waitForTransactionReceipt({ hash: verifierHash });
if (verifierReceipt.status !== 'success') throw new Error('verifier deploy reverted');
const verifier = verifierReceipt.contractAddress;
if (verifier.toLowerCase() !== plan.verifierAddress.toLowerCase()) {
  throw new Error(`deployed verifier ${verifier} != predicted ${plan.verifierAddress}; refusing adapter deploy`);
}
const verifierOnchainCodeHash = keccak256(await publicClient.getBytecode({ address: verifier }));
if (verifierOnchainCodeHash !== verifierCodeHash) {
  throw new Error(`deployed verifier code hash ${verifierOnchainCodeHash} != artifact ${verifierCodeHash}`);
}
console.log(`  verifier: ${verifier} (tx ${verifierHash})`);

// 2. Adapters, each pinned to the real token and to its own wire hash.
const deployed = {};
for (const { scope, key, label, wire, sourceConfigHash } of plan.wires) {
  const direct = scope === 0;
  console.log(`Deploying ${label} adapter (scope ${scope})`);
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
  if (receipt.status !== 'success') throw new Error(`${label} adapter deploy reverted`);

  const abi = YahooAdapterArtifact.abi;
  const [onchainWire, onchainFeed, onchainVerifier, onchainToken] = await Promise.all([
    publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'sourceConfigHash' }),
    publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'feedId' }),
    publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'verifier' }),
    publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'stockToken' }),
  ]);
  if (onchainWire !== sourceConfigHash) throw new Error(`${label}: sourceConfigHash mismatch`);
  if (onchainFeed !== wire.feedId) throw new Error(`${label}: feedId mismatch`);
  if (onchainVerifier.toLowerCase() !== verifier.toLowerCase()) throw new Error(`${label}: verifier mismatch`);
  if (!direct && onchainToken.toLowerCase() !== asset.token.toLowerCase()) throw new Error(`${label}: stockToken mismatch`);

  deployed[key] = wire;
  deployed[`${key}Hash`] = sourceConfigHash;
  deployed[`${label}Adapter`] = receipt.contractAddress;
  console.log(`  ${label}: ${receipt.contractAddress} (tx ${hash})`);
}

const evidence = {
  chainId,
  symbol,
  stockToken: asset.token,
  capabilityMask: 0b110,
  verifier,
  verifierCodeHash,
  reporter,
  directAdapter: deployed.directAdapter,
  regularAdapter: deployed.regularAdapter,
  extendedAdapter: deployed.extendedAdapter,
  directWire: deployed.directWire,
  regularWire: deployed.regularWire,
  extendedWire: deployed.extendedWire,
  directWireHash: deployed.directWireHash,
  regularWireHash: deployed.regularWireHash,
  extendedWireHash: deployed.extendedWireHash,
  deployedAt: new Date().toISOString(),
  rightsVerified: false,
  note: 'Adapters prove the source wiring is pinned on chain. They do not prove the underlying quote rights.',
};
const existing = existsSync(EVIDENCE_PATH) ? JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) : {};
writeFileSync(EVIDENCE_PATH, `${JSON.stringify({ ...existing, ...evidence }, null, 2)}\n`);
console.log(`Wrote ${EVIDENCE_PATH}`);
