#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseEther, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';
import { signYahooSourceSample } from '../../packages/protocol/src/yahoo-attestation.mjs';

const ZERO32 = '0x' + '0'.repeat(64);
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import SessionArtifact from '../../contracts/out/SessionRegistry.sol/SessionRegistry.json' with { type: 'json' };

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
const reporterPk = env.YAHOO_REPORTER_PRIVATE_KEY;

if (!rpcUrl || !deployerPk || !reporterPk) throw new Error('Missing keys');

const stockAdapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const assetQueue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));

const { directAdapter, regularAdapter, directWireHash, regularWireHash, regularWire } = stockAdapters;
const stockAssetId = assetQueue.stock.descriptorId;

const deployer = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const reporter = privateKeyToAccount(reporterPk.startsWith('0x') ? reporterPk : `0x${reporterPk}`);

const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: deployer, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || '0x20a066123c260bc6c5253f75e261c5056fde4bea';
const sessionRegistry = TESTNET.contracts.sessionRegistry;

console.log('Publishing fresh prices for Asset:', stockAssetId);
console.log('SessionRegistry:', sessionRegistry);

const block = await publicClient.getBlock();
const now = Number(block.timestamp);
const price18 = parseEther('250.00');

// 1. Direct quote
const sampleDirect = {
  descriptorId: ZERO32,
  feedId: ZERO32,
  phase: 0,
  price18,
  observedAt: BigInt(now - 1),
  inputAt: BigInt(now - 1),
  validFrom: BigInt(now - 1),
  expiresAt: BigInt(now + 300),
  validUntil: BigInt(now + 119),
  reportHash: keccak256(stringToHex(`aapl-direct-quote-${now}`)),
};

console.log('Signing direct quote...');
const signedDirect = await signYahooSourceSample(sampleDirect, {
  sourceConfigHash: directWireHash,
  chainId,
  verifier,
  privateKey: reporterPk,
});

console.log('Publishing direct quote to Direct Adapter...');
const directTx = await walletClient.writeContract({
  address: directAdapter,
  abi: YahooAdapterArtifact.abi,
  functionName: 'publishDirect',
  args: [sampleDirect, signedDirect.signature],
});
await publicClient.waitForTransactionReceipt({ hash: directTx });
console.log('Direct quote published:', directTx);

// 2. Stream report
const sampleStream = {
  descriptorId: ZERO32,
  feedId: regularWire.feedId,
  phase: 2, // PHASE_REGULAR
  price18,
  observedAt: BigInt(now - 1),
  inputAt: BigInt(now - 1),
  validFrom: BigInt(now - 1),
  expiresAt: BigInt(now + 300),
  validUntil: BigInt(now + 119),
  reportHash: keccak256(stringToHex(`aapl-stream-report-${now}`)),
};

console.log('Signing stream report...');
const signedStream = await signYahooSourceSample(sampleStream, {
  sourceConfigHash: regularWireHash,
  chainId,
  verifier,
  privateKey: reporterPk,
});

console.log('Submitting report to SessionRegistry...');
const submitTx = await walletClient.writeContract({
  address: sessionRegistry,
  abi: SessionArtifact.abi,
  functionName: 'submitReports',
  args: [stockAssetId, [signedStream.report]],
});
await publicClient.waitForTransactionReceipt({ hash: submitTx });
console.log('Stream report submitted:', submitTx);

// 3. Refresh health
console.log('Calling refreshHealth on SessionRegistry...');
const refreshTx = await walletClient.writeContract({
  address: sessionRegistry,
  abi: SessionArtifact.abi,
  functionName: 'refreshHealth',
  args: [stockAssetId],
});
await publicClient.waitForTransactionReceipt({ hash: refreshTx });

const health = await publicClient.readContract({
  address: sessionRegistry,
  abi: SessionArtifact.abi,
  functionName: 'health',
  args: [stockAssetId],
});

console.log('\n=== SESSION HEALTH ===');
console.log('Ready:             ', health.ready);
console.log('ReasonBits:        ', health.reasonBits.toString());
console.log('HealthySince:      ', health.healthySince.toString());
console.log('ValidUntil:        ', health.validUntil.toString());
console.log('LatestObservation: ', health.latestObservation.toString());

if (!health.ready || health.reasonBits !== 0n) {
  throw new Error(`Health not ready: reasonBits = ${health.reasonBits}`);
}

console.log('\n>>> STOCK ASSET HEALTH IS 100% READY AND VERIFIED ONCHAIN! <<<');
