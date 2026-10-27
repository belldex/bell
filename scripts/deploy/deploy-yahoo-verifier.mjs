#!/usr/bin/env node
// Deploy YahooSourceVerifier to Robinhood Chain Testnet using the existing deployer key.
// Writes the deployed address to .env (YAHOO_SOURCE_VERIFIER_ADDRESS) and prints tx evidence.
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256 } from 'viem';

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

// Minimal raw creation code for a verifier with a fixed reporter. Rather than relying on forge
// artifact paths at runtime, we deploy the artifact JSON from the local compiled out/ directory.
const artifact = JSON.parse(readFileSync('contracts/out/YahooSourceVerifier.sol/YahooSourceVerifier.json', 'utf8'));
const abi = artifact.abi;
const bytecode = artifact.bytecode.object;
if (!bytecode || bytecode === '0x') throw new Error('artifact bytecode missing');

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const pk = env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl || !pk) throw new Error('RH_TESTNET_RPC_PRIMARY and DEPLOYER_PRIVATE_KEY are required');

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== 46630) throw new Error(`Wrong chain ${chainId}; expected 46630 (testnet)`);

const reporter = env.YAHOO_REPORTER_ADDRESS;
if (!reporter) throw new Error('YAHOO_REPORTER_ADDRESS must be set first');
console.log(`Deploying YahooSourceVerifier(reporter=${reporter}) from ${account.address} on chain ${chainId}`);

const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [reporter],
});
console.log('tx hash:', hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('status:', receipt.status, '| block:', receipt.blockNumber.toString(), '| contract:', receipt.contractAddress);
if (receipt.status !== 'success') throw new Error('deployment reverted');
const code = await publicClient.getBytecode({ address: receipt.contractAddress });
if (!code || code === '0x') throw new Error('no code at deployed address');
console.log('codeHash:', keccak256(code));

// Wire the verifier into .env for the signing path.
const updated = readFileSync('.env', 'utf8').replace(
  /YAHOO_SOURCE_VERIFIER_ADDRESS=.*/,
  `YAHOO_SOURCE_VERIFIER_ADDRESS=${receipt.contractAddress}`,
);
writeFileSync('.env', updated);
console.log('.env YAHOO_SOURCE_VERIFIER_ADDRESS set to', receipt.contractAddress);
console.log(JSON.stringify({ txHash: hash, blockNumber: receipt.blockNumber.toString(), contractAddress: receipt.contractAddress, codeHash: keccak256(code), reporter }, null, 2));
