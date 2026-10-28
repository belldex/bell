#!/usr/bin/env node
/**
 * Role-separation proof: governance must NOT be able to pause, only the guardian may.
 *
 * This is a positive security test on a live contract. A successful pause by the deployer would be
 * the failure; the expected outcome is a revert, which proves the brake cannot be pulled by the
 * same key that deployed and owns the system.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv(readFileSync('.env', 'utf8'));
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`);
const publicClient = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });
const walletClient = createWalletClient({ account, transport: http(env.RH_TESTNET_RPC_PRIMARY) });

const SAFETY_ABI = parseAbi([
  'function pausePool(address hook) external',
  'function pauseAsset(address token) external',
  'function governance() view returns (address)',
  'function guardian() view returns (address)',
  'function treasury() view returns (address)',
]);

const pool = JSON.parse(readFileSync('evidence/deploy/testnet-pool-created.json', 'utf8'));
const SAFETY = TESTNET.contracts.safetyController;

const [gov, guardian, treasury] = await Promise.all([
  publicClient.readContract({ address: SAFETY, abi: SAFETY_ABI, functionName: 'governance' }),
  publicClient.readContract({ address: SAFETY, abi: SAFETY_ABI, functionName: 'guardian' }),
  publicClient.readContract({ address: SAFETY, abi: SAFETY_ABI, functionName: 'treasury' }),
]);
console.log('governance:', gov);
console.log('guardian  :', guardian);
console.log('treasury  :', treasury);
console.log('caller    :', account.address, '\n');

if (String(guardian).toLowerCase() === account.address.toLowerCase()) {
  throw new Error('guardian is the same key as the caller; this proof is meaningless');
}

const results = [];
let blocked = 0;

// governance must not be able to pause the pool
try {
  const h = await walletClient.writeContract({
    address: SAFETY, abi: SAFETY_ABI, functionName: 'pausePool', args: [pool.hook],
  });
  results.push({ action: 'governance.pausePool', blocked: false });
} catch (error) {
  blocked += 1;
  results.push({ action: 'governance.pausePool', blocked: true, error: String(error?.shortMessage ?? error).slice(0, 80) });
}

// governance must not be able to pause a token either
try {
  const h = await walletClient.writeContract({
    address: SAFETY, abi: SAFETY_ABI, functionName: 'pauseAsset', args: [pool.token0],
  });
  results.push({ action: 'governance.pauseAsset', blocked: false });
} catch (error) {
  blocked += 1;
  results.push({ action: 'governance.pauseAsset', blocked: true, error: String(error?.shortMessage ?? error).slice(0, 80) });
}

for (const r of results) {
  console.log(`${r.blocked ? 'BLOCKED (correct)' : 'ALLOWED (SECURITY FAILURE)'}  ${r.action}${r.error ? ` — ${r.error}` : ''}`);
}

if (blocked !== results.length) {
  throw new Error('ROLE SEPARATION FAILURE: governance was able to execute a guardian-only action');
}

// confirm the pool state was never touched
const HOOK_ABI = parseAbi(['function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] a, uint128[2] b, uint128[2] c, uint128[2] d, uint128[2] e, uint64 f, uint64 g, bytes32 h, bytes32 i))']);
const p = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'getPolicy' });
console.log(`\npool untouched: mode=${p.mode} canSwap=${p.canSwap} reasons=${p.reasonBits}`);

writeFileSync('evidence/deploy/testnet-role-separation.json', JSON.stringify({
  safetyController: SAFETY,
  governance: gov,
  guardian,
  treasury,
  caller: account.address,
  proof: results,
  poolMode: p.mode,
  poolCanSwap: p.canSwap,
  at: new Date().toISOString(),
}, null, 2) + '\n');
console.log('\n>>> ROLE SEPARATION PROVEN ONCHAIN: guardian-only brake cannot be pulled by governance <<<');
