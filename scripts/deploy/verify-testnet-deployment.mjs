#!/usr/bin/env node
/**
 * Regenerate evidence/deploy/testnet-46630-verification.json from the live chain.
 *
 * The verification file is the second of the three address sources that
 * `check-testnet-addresses.mjs` cross-checks. It went stale once already (it kept the
 * addresses of a superseded deployment after the manifest was re-deployed), which made
 * the drift guard fail. This script derives every value from the chain and the current
 * manifest instead of hand-editing, so the two cannot disagree.
 *
 * Read-only: it never sends a transaction.
 *
 * Usage:
 *   node scripts/deploy/verify-testnet-deployment.mjs            # write evidence
 *   node scripts/deploy/verify-testnet-deployment.mjs --check    # exit 1 if evidence is stale
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, http, keccak256 } from 'viem';
import { formatDeployManifest } from './deploy-manifest.mjs';

const MANIFEST_URL = new URL('../../evidence/deploy/testnet-46630.json', import.meta.url);
const VERIFICATION_URL = new URL('../../evidence/deploy/testnet-46630-verification.json', import.meta.url);
const BROADCAST_URL = new URL('../../contracts/broadcast/DeployTestnet.s.sol/46630/run-latest.json', import.meta.url);

const CONTRACT_KEYS = [
  'safetyController', 'assetRegistry', 'calendarRegistry', 'sessionRegistry',
  'poolManager', 'positionManager', 'hookDeployer', 'poolFactory', 'weth', 'router',
];

const ABI = [
  { type: 'function', name: 'poolManager', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'canonicalWeth', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'WETH9', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'permit2', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'hookDeployer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'positionManager', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'serviceToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'serviceRecipient', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'serviceFee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  { type: 'function', name: 'liquidityMode', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'factory', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'templateCodeHash', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'profileHash', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'assetRegistry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'calendarRegistry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'sessionRegistry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'modeEvaluator', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'safetyController', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'governance', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'guardian', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'treasury', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
];

/** Bindings that must point at the manifest, or the deployment is not wired. */
const BINDINGS = [
  ['router', 'poolManager', 'poolManager'],
  ['router', 'canonicalWeth', 'weth'],
  ['positionManager', 'poolManager', 'poolManager'],
  ['positionManager', 'WETH9', 'weth'],
  ['positionManager', 'permit2', 'permit2'],
  ['poolFactory', 'hookDeployer', 'hookDeployer'],
  ['poolFactory', 'positionManager', 'positionManager'],
  ['poolFactory', 'serviceToken', 'feeToken'],
  ['hookDeployer', 'factory', 'poolFactory'],
  ['hookDeployer', 'sessionRegistry', 'sessionRegistry'],
  ['sessionRegistry', 'assetRegistry', 'assetRegistry'],
  ['sessionRegistry', 'calendarRegistry', 'calendarRegistry'],
  ['assetRegistry', 'safetyController', 'safetyController'],
  ['calendarRegistry', 'safetyController', 'safetyController'],
  ['poolManager', 'owner', 'deployer'],
];

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export async function buildVerification({
  manifest,
  client,
  broadcast,
  sourceCommit,
  verifiedAt,
  expectedChainId = 46630,
  status = 'REHEARSAL_DEPLOYED',
  feeTokenLabel = 'REHEARSAL_FIXTURE_NOT_USDG',
  notCovered,
}) {
  const chainId = await client.getChainId();
  if (chainId !== expectedChainId) {
    throw new Error(`RPC answered chainId ${chainId}, expected ${expectedChainId}`);
  }

  const block = await client.getBlock();
  const contracts = {};
  for (const key of (manifest.modeEvaluator ? [...CONTRACT_KEYS, 'modeEvaluator'] : CONTRACT_KEYS)) {
    const address = manifest[key];
    const code = await client.getBytecode({ address, blockNumber: block.number });
    if (!code || code === '0x') throw new Error(`${key} has no code at ${address}`);
    contracts[key] = { address, codeBytes: (code.length - 2) / 2, codeHash: keccak256(code) };
  }

  const feeCode = await client.getBytecode({ address: manifest.feeToken, blockNumber: block.number });
  if (!feeCode || feeCode === '0x') throw new Error(`feeToken has no code at ${manifest.feeToken}`);
  contracts.feeToken = {
    address: manifest.feeToken,
    codeBytes: (feeCode.length - 2) / 2,
    codeHash: keccak256(feeCode),
    decimals: Number(await client.readContract({ address: manifest.feeToken, abi: ABI, functionName: 'decimals' })),
    label: feeTokenLabel,
  };

  const wiringChecks = {};
  const mismatches = [];
  for (const [contract, method, expectedKey] of BINDINGS) {
    const actual = await client.readContract({ address: manifest[contract], abi: ABI, functionName: method });
    wiringChecks[`${contract}.${method}`] = actual;
    if (!same(actual, manifest[expectedKey])) {
      mismatches.push(`${contract}.${method}() = ${actual}, manifest ${expectedKey} = ${manifest[expectedKey]}`);
    }
  }
  if (manifest.modeEvaluator) {
    const actual = await client.readContract({ address: manifest.hookDeployer, abi: ABI, functionName: 'modeEvaluator' });
    wiringChecks['hookDeployer.modeEvaluator'] = actual;
    if (!same(actual, manifest.modeEvaluator)) mismatches.push(`hookDeployer.modeEvaluator() = ${actual}, manifest modeEvaluator = ${manifest.modeEvaluator}`);
  }
  const roles = {};
  for (const role of ['governance', 'guardian', 'treasury']) {
    roles[role] = await client.readContract({ address: manifest.safetyController, abi: ABI, functionName: role });
  }
  wiringChecks['safetyController.roles'] = {
    ...roles,
    distinct: new Set(Object.values(roles).map((a) => a.toLowerCase())).size === 3,
  };
  wiringChecks['factory.liquidityMode'] = Number(await client.readContract({ address: manifest.poolFactory, abi: ABI, functionName: 'liquidityMode' }));
  wiringChecks['factory.serviceFee'] = (await client.readContract({ address: manifest.poolFactory, abi: ABI, functionName: 'serviceFee' })).toString();
  wiringChecks['factory.serviceRecipient'] = await client.readContract({ address: manifest.poolFactory, abi: ABI, functionName: 'serviceRecipient' });
  wiringChecks['factory.profileHash'] = await client.readContract({ address: manifest.poolFactory, abi: ABI, functionName: 'profileHash' });
  wiringChecks['hookDeployer.templateCodeHash'] = await client.readContract({ address: manifest.hookDeployer, abi: ABI, functionName: 'templateCodeHash' });
  wiringChecks['weth.symbol'] = await client.readContract({ address: manifest.weth, abi: ABI, functionName: 'symbol' });
  wiringChecks['weth.decimals'] = Number(await client.readContract({ address: manifest.weth, abi: ABI, functionName: 'decimals' }));
  if (mismatches.length > 0) throw new Error(`wiring mismatch: ${mismatches.join('; ')}`);

  const { manifestHash } = formatDeployManifest(manifest);

  const receipts = broadcast?.receipts ?? [];
  const blocks = receipts.map((r) => Number(BigInt(r.blockNumber)));
  let gasUsed = 0n;
  let priceWei = 0n;
  for (const r of receipts) {
    if (r.gasUsed) gasUsed += BigInt(r.gasUsed);
    if (r.effectiveGasPrice) priceWei = BigInt(r.effectiveGasPrice);
  }

  return {
    chainId,
    verifiedAt,
    status,
    sourceCommit: sourceCommit ?? broadcast?.commit ?? 'UNKNOWN',
    manifestHash,
    deployer: manifest.deployer,
    blocks: {
      first: blocks.length ? Math.min(...blocks) : null,
      last: blocks.length ? Math.max(...blocks) : null,
      verifiedAtBlock: Number(block.number),
    },
    contracts,
    wiringChecks,
    gas: {
      txCount: receipts.length,
      used: gasUsed.toString(),
      priceWei: priceWei.toString(),
      costEth: (Number(gasUsed * priceWei) / 1e18).toString(),
    },
    notCovered: notCovered ?? [
      'PRICE_GUARDED pool class remains blocked',
      'Deployed profile is PUBLIC only (liquidityMode=0, treasuryAdapter=0): the TREASURY_ONLY path cannot be exercised on this factory, so TreasuryAdapter has no live deployment',
      'No pool has been created: asset admission needs a stock descriptor, a calendar root and a healthy source; only the oracleless WETH counterasset is ACTIVE',
      'Keeper A (Supabase) and Keeper B (Cloudflare) are not pointed at these addresses',
      'PoolManager ownership is still held by the deployer; handover rehearsal has not run',
      'SafetyController treasury is the burn address 0x...dEaD: treasury exit and handover cannot be rehearsed',
    ],
  };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const env = loadEnv(await readFile(new URL('../../.env', import.meta.url), 'utf8').catch(() => ''));
  const rpcUrl = process.env.RH_TESTNET_RPC_PRIMARY || env.RH_TESTNET_RPC_PRIMARY;
  if (!rpcUrl) throw new Error('RH_TESTNET_RPC_PRIMARY is required');

  const manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8'));
  const broadcast = JSON.parse(await readFile(BROADCAST_URL, 'utf8')).receipts
    ? JSON.parse(await readFile(BROADCAST_URL, 'utf8'))
    : null;
  const client = createPublicClient({ transport: http(rpcUrl) });

  const next = await buildVerification({
    manifest,
    client,
    broadcast,
    verifiedAt: new Date().toISOString().slice(0, 10),
  });

  if (checkOnly) {
    const current = JSON.parse(await readFile(VERIFICATION_URL, 'utf8'));
    const drift = [];
    if (current.manifestHash !== next.manifestHash) drift.push(`manifestHash ${current.manifestHash} != ${next.manifestHash}`);
    for (const key of Object.keys(next.contracts)) {
      const recorded = current.contracts?.[key];
      if (!recorded) { drift.push(`${key} not recorded`); continue; }
      if (!same(recorded.address, next.contracts[key].address)) drift.push(`${key} address ${recorded.address} != ${next.contracts[key].address}`);
      if (recorded.codeBytes !== next.contracts[key].codeBytes) drift.push(`${key} codeBytes ${recorded.codeBytes} != ${next.contracts[key].codeBytes}`);
    }
    if (drift.length > 0) {
      console.error('STALE VERIFICATION EVIDENCE');
      for (const line of drift) console.error(`- ${line}`);
      console.error('Run: node scripts/deploy/verify-testnet-deployment.mjs');
      process.exit(1);
    }
    console.log('OK   verification evidence matches the live chain');
    return;
  }

  await writeFile(VERIFICATION_URL, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`wrote ${next.contracts ? Object.keys(next.contracts).length : 0} contracts at block ${next.blocks.verifiedAtBlock}`);
  console.log(`manifestHash ${next.manifestHash}`);
}

if (process.argv[1] && process.argv[1].endsWith('verify-testnet-deployment.mjs')) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
