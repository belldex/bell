#!/usr/bin/env node
// Deploy a stream-mode YahooAttestedSourceAdapter (phaseScope 1/2/3) on Testnet pinned to the
// deployed verifier and an AAPL Testnet facade token. The adapter binds the MAINNET AAPL address
// as its pinned `stockToken` identity, but the constructor requires a token with code on the
// deployment chain, so the rehearsal uses a clearly-labelled facade. This makes the multi-session
// Yahoo path ready for queue/activate without claiming any canonical Testnet stock deployment.
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import YahooVerifierArtifact from '../../contracts/out/YahooSourceVerifier.sol/YahooSourceVerifier.json' with { type: 'json' };
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import FacadeArtifact from '../../contracts/out/AaplTestnetFacade.sol/AaplTestnetFacade.json' with { type: 'json' };
import { buildYahooSourceWire } from '../../packages/protocol/src/yahoo-attestation.mjs';
import { keccak256 } from 'viem';

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const deployerPk = env.DEPLOYER_PRIVATE_KEY;
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS;
if (!rpcUrl || !deployerPk || !verifier) throw new Error('RPC, DEPLOYER_PRIVATE_KEY, YAHOO_SOURCE_VERIFIER_ADDRESS required');

const MAINNET_CHAIN_ID = 4663;
const AAPL_MAINNET = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9';
const verifierCodeHash = keccak256(YahooVerifierArtifact.deployedBytecode.object);

const account = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
const chainId = await publicClient.getChainId();
if (chainId !== 46630) throw new Error(`Wrong chain ${chainId}; expected 46630`);

// Deploy the AAPL facade (testnet-only, zero value, clearly labelled).
console.log('Deploying AAPL Testnet rehearsal facade...');
const facadeHash = await walletClient.deployContract({
  abi: FacadeArtifact.abi,
  bytecode: FacadeArtifact.bytecode.object,
});
const facadeReceipt = await publicClient.waitForTransactionReceipt({ hash: facadeHash });
if (facadeReceipt.status !== 'success') throw new Error('AAPL facade deploy reverted');
const facadeAddress = facadeReceipt.contractAddress;
const facadeSymbol = await publicClient.readContract({ address: facadeAddress, abi: FacadeArtifact.abi, functionName: 'symbol' });
console.log(`  facade tx  : ${facadeHash}`);
console.log(`  facade addr: ${facadeAddress} (${facadeSymbol})`);

const results = [];
for (const scope of [1, 2, 3]) {
  const label = scope === 1 ? 'regular' : scope === 2 ? 'extended' : 'overnight';
  const wireInfo = buildYahooSourceWire({
    chainId: MAINNET_CHAIN_ID,
    token: AAPL_MAINNET,
    verifier,
    verifierCodeHash,
    phaseScope: scope,
    symbol: 'AAPL',
  });
  console.log(`\nDeploying ${label} adapter (phaseScope=${scope})`);
  console.log('  feedId  :', wireInfo.wire.feedId);
  console.log('  wireHash:', wireInfo.sourceConfigHash);
  const hash = await walletClient.deployContract({
    abi: YahooAdapterArtifact.abi,
    bytecode: YahooAdapterArtifact.bytecode.object,
    args: [
      verifier,
      wireInfo.sourceConfigHash,
      wireInfo.wire.feedId,
      scope,
      false,
      facadeAddress,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} adapter deploy reverted`);
  const abi = YahooAdapterArtifact.abi;
  const onchainWire = await publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'sourceConfigHash' });
  const onchainFeed = await publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'feedId' });
  const onchainVerifier = await publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'verifier' });
  const onchainToken = await publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'stockToken' });
  if (onchainWire !== wireInfo.sourceConfigHash) throw new Error(`${label} wireHash mismatch`);
  if (onchainFeed !== wireInfo.wire.feedId) throw new Error(`${label} feedId mismatch`);
  if (onchainVerifier.toLowerCase() !== verifier.toLowerCase()) throw new Error(`${label} verifier mismatch`);
  if (onchainToken.toLowerCase() !== facadeAddress.toLowerCase()) throw new Error(`${label} stockToken mismatch`);
  console.log(`  tx      : ${hash} (block ${receipt.blockNumber.toString()})`);
  console.log(`  address : ${receipt.contractAddress}`);
  results.push({
    scope, label, feedId: wireInfo.wire.feedId, sourceConfigHash: wireInfo.sourceConfigHash,
    adapterAddress: receipt.contractAddress, deployTxHash: hash, blockNumber: receipt.blockNumber.toString(),
  });
}

console.log('\nAll three stream adapters deployed and onchain-verified.');
const existing = JSON.parse(readFileSync('evidence/deploy/yahoo-verifier-adapter-testnet.json', 'utf8'));
existing.streamAdapters = results;
existing.aaplTestnetFacade = {
  address: facadeAddress,
  deployTxHash: facadeHash,
  symbol: facadeSymbol,
  isCanonicalToken: false,
  reason: 'Mainnet AAPL has no Testnet deployment; the stream-mode adapter constructor requires stockToken_.code.length != 0 on the deployment chain. This facade satisfies that check without claiming canonical identity.',
};
existing.recordedAt = new Date().toISOString();
existing.nextSteps = existing.nextSteps.filter((s) => !s.startsWith('deploy a stream-mode'));
existing.nextSteps.unshift('queue/activate the AAPL stock descriptor on the current registry binding the facade token address on Testnet (the direct descriptor binds canonical mainnet AAPL identity)');
writeFileSync('evidence/deploy/yahoo-verifier-adapter-testnet.json', `${JSON.stringify(existing, null, 2)}\n`);
console.log('evidence/deploy/yahoo-verifier-adapter-testnet.json updated.');
