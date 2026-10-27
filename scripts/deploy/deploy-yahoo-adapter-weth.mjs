#!/usr/bin/env node
// Deploy YahooAttestedSourceAdapter (direct price mode) pinned to the deployed verifier and a
// canonical Robinhood Stock Token mainnet identity (AAPL by default). The adapter is deployed to
// Testnet for rehearsal; the canonicalTokenId binds chainId 4663 + the mainnet token address so the
// SourceWire hash matches what a mainnet deployment of the same configuration would use.
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import YahooSourceVerifierArtifact from '../../contracts/out/YahooSourceVerifier.sol/YahooSourceVerifier.json' with { type: 'json' };
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import { buildYahooSourceWire } from '../../packages/protocol/src/yahoo-attestation.mjs';
import { keccak256, zeroAddress } from 'viem';

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
const pk = env.DEPLOYER_PRIVATE_KEY;
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS;
if (!rpcUrl || !pk || !verifier) throw new Error('RPC, DEPLOYER_PRIVATE_KEY, and YAHOO_SOURCE_VERIFIER_ADDRESS are required');

// Canonical Robinhood Stock Token on Robinhood mainnet (official assets API, chainId 4663).
// AAPL is the rehearsal default because it has the deepest real-quote availability; its
// uiMultiplier is read live during publishDirect to produce the adjusted token price.
const AAPL_MAINNET = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9';
const verifierCodeHash = keccak256(YahooSourceVerifierArtifact.deployedBytecode.object);

const wireInfo = buildYahooSourceWire({
  chainId: 4663,
  token: AAPL_MAINNET,
  verifier,
  verifierCodeHash,
  phaseScope: 0,
  symbol: 'AAPL',
});

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
const chainId = await publicClient.getChainId();
if (chainId !== 46630) throw new Error(`Wrong chain ${chainId}; expected 46630`);

console.log('Deploying YahooAttestedSourceAdapter (direct mode)');
console.log('  verifier      :', verifier);
console.log('  stockToken    :', zeroAddress, '(direct mode)');
console.log('  canonical     :', AAPL_MAINNET, '(mainnet identity)');
console.log('  sourceConfigHash:', wireInfo.sourceConfigHash);

const hash = await walletClient.deployContract({
  abi: YahooAdapterArtifact.abi,
  bytecode: YahooAdapterArtifact.bytecode.object,
  args: [verifier, wireInfo.sourceConfigHash, `0x${'00'.repeat(32)}`, 0, true, zeroAddress],
});
console.log('tx hash:', hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('status:', receipt.status, '| block:', receipt.blockNumber.toString(), '| contract:', receipt.contractAddress);
if (receipt.status !== 'success') throw new Error('adapter deployment reverted');

const abi = YahooAdapterArtifact.abi;
const onchainWire = await publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'sourceConfigHash' });
const onchainVerifier = await publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'verifier' });
const onchainFp = await publicClient.readContract({ address: receipt.contractAddress, abi, functionName: 'fingerprint' });
if (onchainWire !== wireInfo.sourceConfigHash) throw new Error('sourceConfigHash mismatch onchain');
if (onchainVerifier.toLowerCase() !== verifier.toLowerCase()) throw new Error('verifier mismatch onchain');
console.log('onchain binding verified. fingerprint:', onchainFp);

console.log(JSON.stringify({
  txHash: hash,
  blockNumber: receipt.blockNumber.toString(),
  adapterAddress: receipt.contractAddress,
  verifier,
  verifierCodeHash,
  sourceConfigHash: wireInfo.sourceConfigHash,
  canonicalTokenId: wireInfo.canonicalTokenId,
  stockToken: AAPL_MAINNET,
  onchainFingerprint: onchainFp,
}, null, 2));
