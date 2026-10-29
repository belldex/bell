#!/usr/bin/env node
/**
 * Read-only mainnet preflight. No transaction is built or signed.
 *
 * Checks the things that would waste real ETH if they were wrong: chain identity, provider
 * agreement, deployer funding, role separation, and that every external address the deploy binds
 * to actually has code on chain.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const MAINNET_CHAIN_ID = 4663;
const CANONICAL_PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const MIN_DEPLOYER_BALANCE = 5n * 10n ** 17n; // 0.5 ETH floor; the suite is ~12 contracts.

function loadEnv() {
  const env = { ...process.env };
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const failures = [];
const notes = [];
const fail = (message) => failures.push(message);

const rpc = env.RH_MAINNET_RPC_PRIMARY;
if (!rpc) fail('RH_MAINNET_RPC_PRIMARY is not set');
const pk = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!pk) fail('RH_MAINNET_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is not set');

if (failures.length === 0) {
  const client = createPublicClient({ transport: http(rpc) });
  const chainId = await client.getChainId();
  if (chainId !== MAINNET_CHAIN_ID) fail(`RPC answered chain ${chainId}, expected ${MAINNET_CHAIN_ID}`);

  const deployer = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`).address;
  const balance = await client.getBalance({ address: deployer });
  if (balance < MIN_DEPLOYER_BALANCE) {
    fail(`deployer ${deployer} holds ${formatEther(balance)} ETH, below the ${formatEther(MIN_DEPLOYER_BALANCE)} floor`);
  }

  const roles = {
    governance: env.MAINNET_GOVERNANCE_ADDRESS,
    guardian: env.MAINNET_GUARDIAN_ADDRESS,
    treasury: env.MAINNET_TREASURY_ADDRESS,
    recipient: env.MAINNET_SERVICE_RECIPIENT,
  };
  const roleEnvNames = {
    governance: 'MAINNET_GOVERNANCE_ADDRESS',
    guardian: 'MAINNET_GUARDIAN_ADDRESS',
    treasury: 'MAINNET_TREASURY_ADDRESS',
    recipient: 'MAINNET_SERVICE_RECIPIENT',
  };
  for (const [key, value] of Object.entries(roles)) {
    if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) fail(`${roleEnvNames[key]} is missing or malformed`);
  }
  const distinct = new Set([roles.governance, roles.guardian, roles.treasury].filter(Boolean).map((a) => a.toLowerCase()));
  if (distinct.size !== 3) fail('governance, guardian and treasury must be three distinct addresses');
  if (roles.treasury?.toLowerCase() === deployer.toLowerCase()) fail('treasury must not be the deployer');
  if (roles.guardian?.toLowerCase() === deployer.toLowerCase()) fail('guardian must not be the deployer');

  for (const [name, address] of [
    ['MAINNET_WETH_ADDRESS', env.MAINNET_WETH_ADDRESS],
    ['MAINNET_FEE_TOKEN_ADDRESS', env.MAINNET_FEE_TOKEN_ADDRESS],
    ['canonical Permit2', CANONICAL_PERMIT2],
  ]) {
    if (!address) { fail(`${name} is not set`); continue; }
    const code = await client.getBytecode({ address });
    if (!code || code === '0x') fail(`${name} (${address}) has no code on chain`);
  }

  if (env.MAINNET_WETH_ADDRESS) {
    const symbol = await client
      .readContract({ address: env.MAINNET_WETH_ADDRESS, abi: parseAbi(['function symbol() view returns (string)']), functionName: 'symbol' })
      .catch(() => null);
    if (symbol !== 'WETH') fail(`MAINNET_WETH_ADDRESS symbol is ${symbol ?? 'unreadable'}, expected WETH`);
  }

  if (env.MAINNET_FEE_TOKEN_ADDRESS) {
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address: env.MAINNET_FEE_TOKEN_ADDRESS, abi: parseAbi(['function decimals() view returns (uint8)']), functionName: 'decimals' }).catch(() => null),
      client.readContract({ address: env.MAINNET_FEE_TOKEN_ADDRESS, abi: parseAbi(['function symbol() view returns (string)']), functionName: 'symbol' }).catch(() => null),
    ]);
    if (decimals === null) fail('fee token does not expose decimals()');
    else notes.push(`fee token ${symbol ?? '(no symbol)'} with ${decimals} decimals`);
    if (symbol && /^mBELL$/i.test(symbol)) fail('fee token looks like the testnet mBELL fixture');
  }

  const secondary = env.RH_MAINNET_RPC_SECONDARY;
  if (secondary) {
    const second = createPublicClient({ transport: http(secondary) });
    const [a, b] = await Promise.all([client.getBlockNumber(), second.getBlockNumber()]);
    const drift = a > b ? a - b : b - a;
    if (drift > 50n) fail(`RPC heads disagree by ${drift} blocks`);
    else notes.push(`RPC heads agree within ${drift} blocks`);
  } else {
    notes.push('RH_MAINNET_RPC_SECONDARY not set; head agreement was not checked');
  }

  console.log(JSON.stringify({
    chainId,
    deployer,
    deployerBalanceEth: formatEther(balance),
    roles,
    notes,
    failures,
    verdict: failures.length === 0 ? 'READY' : 'NOT_READY',
  }, null, 2));
} else {
  console.log(JSON.stringify({ failures, verdict: 'NOT_READY' }, null, 2));
}

process.exit(failures.length === 0 ? 0 : 1);
