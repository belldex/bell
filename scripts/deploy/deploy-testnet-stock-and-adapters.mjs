#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import StockTokenArtifact from '../../contracts/out/AaplRehearsalStockToken.sol/AaplRehearsalStockToken.json' with { type: 'json' };
import YahooVerifierArtifact from '../../contracts/out/YahooSourceVerifier.sol/YahooSourceVerifier.json' with { type: 'json' };
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import { buildYahooSourceWire } from '../../packages/protocol/src/yahoo-attestation.mjs';

const ZERO32 = '0x' + '0'.repeat(64);

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const deployerPk = env.DEPLOYER_PRIVATE_KEY;
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || '0x20a066123c260bc6c5253f75e261c5056fde4bea';

if (!rpcUrl || !deployerPk) throw new Error('RH_TESTNET_RPC_PRIMARY and DEPLOYER_PRIVATE_KEY required');

const account = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== 46630) throw new Error(`Wrong chain ${chainId}; expected 46630`);

console.log('Deployer:', account.address);
console.log('Verifier:', verifier);

// 1. Deploy AaplRehearsalStockToken
console.log('\nDeploying AaplRehearsalStockToken...');
const stockTx = await walletClient.deployContract({
  abi: StockTokenArtifact.abi,
  bytecode: StockTokenArtifact.bytecode.object,
});
const stockReceipt = await publicClient.waitForTransactionReceipt({ hash: stockTx });
if (stockReceipt.status !== 'success') throw new Error('Stock token deployment failed');
const stockToken = stockReceipt.contractAddress;
console.log('StockToken deployed at:', stockToken);

// Mint 10,000,000 tokens to deployer
console.log('Minting 10,000,000 stock tokens to deployer...');
const mintTx = await walletClient.writeContract({
  address: stockToken,
  abi: StockTokenArtifact.abi,
  functionName: 'mint',
  args: [account.address, parseEther('10000000')],
});
await publicClient.waitForTransactionReceipt({ hash: mintTx });
console.log('Minted successfully. Deployer stock balance:', (await publicClient.readContract({
  address: stockToken,
  abi: StockTokenArtifact.abi,
  functionName: 'balanceOf',
  args: [account.address],
})).toString());

// 2. Build SourceWires & Deploy Adapters
const verifierCode = await publicClient.getBytecode({ address: verifier });
if (!verifierCode || verifierCode === '0x') throw new Error('Verifier code missing onchain');
const verifierCodeHash = keccak256(verifierCode);

// Direct Adapter (scope 0)
const directWireInfo = buildYahooSourceWire({
  chainId,
  token: stockToken,
  verifier,
  verifierCodeHash,
  phaseScope: 0,
  symbol: 'AAPL',
});
console.log('\nDeploying Direct Adapter (scope 0)...');
console.log('WireHash:', directWireInfo.sourceConfigHash);
const directTx = await walletClient.deployContract({
  abi: YahooAdapterArtifact.abi,
  bytecode: YahooAdapterArtifact.bytecode.object,
  args: [verifier, directWireInfo.sourceConfigHash, ZERO32, 0, true, stockToken],
});
const directReceipt = await publicClient.waitForTransactionReceipt({ hash: directTx });
if (directReceipt.status !== 'success') throw new Error('Direct adapter deployment failed');
const directAdapter = directReceipt.contractAddress;
console.log('Direct adapter deployed at:', directAdapter);

// Regular Stream Adapter (scope 1)
const regularWireInfo = buildYahooSourceWire({
  chainId,
  token: stockToken,
  verifier,
  verifierCodeHash,
  phaseScope: 1,
  symbol: 'AAPL',
});
console.log('\nDeploying Regular Stream Adapter (scope 1)...');
console.log('FeedId:', regularWireInfo.wire.feedId);
console.log('WireHash:', regularWireInfo.sourceConfigHash);
const regularTx = await walletClient.deployContract({
  abi: YahooAdapterArtifact.abi,
  bytecode: YahooAdapterArtifact.bytecode.object,
  args: [verifier, regularWireInfo.sourceConfigHash, regularWireInfo.wire.feedId, 1, false, stockToken],
});
const regularReceipt = await publicClient.waitForTransactionReceipt({ hash: regularTx });
if (regularReceipt.status !== 'success') throw new Error('Regular adapter deployment failed');
const regularAdapter = regularReceipt.contractAddress;
console.log('Regular adapter deployed at:', regularAdapter);

// Extended Stream Adapter (scope 2)
const extendedWireInfo = buildYahooSourceWire({
  chainId,
  token: stockToken,
  verifier,
  verifierCodeHash,
  phaseScope: 2,
  symbol: 'AAPL',
});
console.log('\nDeploying Extended Stream Adapter (scope 2)...');
const extendedTx = await walletClient.deployContract({
  abi: YahooAdapterArtifact.abi,
  bytecode: YahooAdapterArtifact.bytecode.object,
  args: [verifier, extendedWireInfo.sourceConfigHash, extendedWireInfo.wire.feedId, 2, false, stockToken],
});
const extendedReceipt = await publicClient.waitForTransactionReceipt({ hash: extendedTx });
if (extendedReceipt.status !== 'success') throw new Error('Extended adapter deployment failed');
const extendedAdapter = extendedReceipt.contractAddress;
console.log('Extended adapter deployed at:', extendedAdapter);

const result = {
  stockToken,
  directAdapter,
  regularAdapter,
  extendedAdapter,
  directWire: directWireInfo.wire,
  regularWire: regularWireInfo.wire,
  extendedWire: extendedWireInfo.wire,
  directWireHash: directWireInfo.sourceConfigHash,
  regularWireHash: regularWireInfo.sourceConfigHash,
  extendedWireHash: extendedWireInfo.sourceConfigHash,
  deployBlock: Number(extendedReceipt.blockNumber),
};

writeFileSync('evidence/deploy/testnet-stock-adapters.json', JSON.stringify(result, null, 2) + '\n');
console.log('\nSuccessfully saved evidence/deploy/testnet-stock-adapters.json');
