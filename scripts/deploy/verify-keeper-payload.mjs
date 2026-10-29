#!/usr/bin/env node
/**
 * Prove the keeper's publish payload is accepted by the real contracts, without broadcasting.
 *
 * The market being closed means no real Yahoo quote exists, so this builds a synthetic sample and
 * only runs eth_call. Nothing is written onchain: a passing result means the ABI encoding, EIP-712
 * signature, feed/phase binding, and freshness bounds are all correct, so the scheduled keeper will
 * not fail for a wiring reason when the session opens.
 *
 * Run: node scripts/deploy/verify-keeper-payload.mjs
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, keccak256, parseAbi, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { signYahooSourceSample } from '../../packages/protocol/src/yahoo-attestation.mjs';

const ZERO32 = `0x${'0'.repeat(64)}`;

function loadEnv() {
  const env = { ...process.env };
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const manifest = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));
const adapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const queue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));

const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`);
const client = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });
const chainId = await client.getChainId();
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || '0x20a066123c260bc6c5253f75e261c5056fde4bea';

const DIRECT_ABI = parseAbi([
  'function publishDirect((bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash),bytes)',
]);
const SESSION_ABI = parseAbi([
  'function submitReports(bytes32,bytes[])',
  'function refreshHealth(bytes32) returns (uint256)',
]);

const block = await client.getBlock();
const now = Number(block.timestamp);

// Synthetic observation: valid shape and bounds, but explicitly not a market price.
const observedAt = BigInt(now - 5);
const price18 = 250n * 10n ** 18n;
const validUntil = observedAt + 100n;

const results = [];

for (const [label, phase, feedId, wireHash] of [
  ['PRE', 1, adapters.extendedWire.feedId, adapters.extendedWireHash],
  ['REGULAR', 2, adapters.regularWire.feedId, adapters.regularWireHash],
]) {
  const sampleDirect = {
    descriptorId: ZERO32, feedId: ZERO32, phase: 0, price18, observedAt,
    inputAt: BigInt(now), validFrom: observedAt, expiresAt: BigInt(now + 300), validUntil,
    reportHash: keccak256(stringToHex(`payload-check-direct-${label}-${now}`)),
  };
  const signedDirect = await signYahooSourceSample(sampleDirect, {
    sourceConfigHash: adapters.directWireHash, chainId, verifier, privateKey: env.YAHOO_REPORTER_PRIVATE_KEY,
  });
  try {
    await client.simulateContract({
      account, address: adapters.directAdapter, abi: DIRECT_ABI, functionName: 'publishDirect',
      args: [sampleDirect, signedDirect.signature],
    });
    results.push({ step: `${label} publishDirect`, ok: true });
  } catch (error) {
    results.push({ step: `${label} publishDirect`, ok: false, error: String(error.shortMessage ?? error.message).slice(0, 160) });
  }

  const sampleStream = {
    descriptorId: ZERO32, feedId, phase, price18, observedAt,
    inputAt: BigInt(now), validFrom: observedAt, expiresAt: BigInt(now + 300), validUntil,
    reportHash: keccak256(stringToHex(`payload-check-stream-${label}-${now}`)),
  };
  const signedStream = await signYahooSourceSample(sampleStream, {
    sourceConfigHash: wireHash, chainId, verifier, privateKey: env.YAHOO_REPORTER_PRIVATE_KEY,
  });
  try {
    await client.simulateContract({
      account, address: manifest.sessionRegistry, abi: SESSION_ABI, functionName: 'submitReports',
      args: [queue.stock.descriptorId, [signedStream.report]],
    });
    results.push({ step: `${label} submitReports`, ok: true });
  } catch (error) {
    results.push({ step: `${label} submitReports`, ok: false, error: String(error.shortMessage ?? error.message).slice(0, 160) });
  }
}

try {
  await client.simulateContract({
    account, address: manifest.sessionRegistry, abi: SESSION_ABI, functionName: 'refreshHealth',
    args: [queue.stock.descriptorId],
  });
  results.push({ step: 'refreshHealth', ok: true });
} catch (error) {
  results.push({ step: 'refreshHealth', ok: false, error: String(error.shortMessage ?? error.message).slice(0, 160) });
}

console.log(JSON.stringify({
  note: 'eth_call only; nothing was broadcast and no price was written onchain',
  assetId: queue.stock.descriptorId,
  reporter: privateKeyToAccount(env.YAHOO_REPORTER_PRIVATE_KEY).address,
  results,
}, null, 2));

process.exit(results.every((r) => r.ok) ? 0 : 1);
