#!/usr/bin/env node
/**
 * Guard against the failure mode we already hit once: the deploy manifest, the
 * verification evidence and the frontend/status module each hold their own copy of the
 * testnet addresses, so a redeploy silently leaves two of the three pointing at contracts
 * that are no longer the ones under test.
 *
 * Offline (default): cross-check the three sources against each other.
 * With --rpc: also prove every address still has code and that the code size matches the
 * recorded evidence.
 *
 * Usage:
 *   node scripts/deploy/check-testnet-addresses.mjs
 *   node scripts/deploy/check-testnet-addresses.mjs --rpc
 */
import { readFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';
import { formatDeployManifest } from './deploy-manifest.mjs';

const MANIFEST_URL = new URL('../../evidence/deploy/testnet-46630.json', import.meta.url);
const VERIFICATION_URL = new URL('../../evidence/deploy/testnet-46630-verification.json', import.meta.url);

/** Contracts the manifest is required to publish (mirrors validateDeployManifest). */
export const MANIFEST_CONTRACT_KEYS = [
  'safetyController',
  'assetRegistry',
  'calendarRegistry',
  'sessionRegistry',
  'poolManager',
  'positionManager',
  'hookDeployer',
  'poolFactory',
  'weth',
  'router'
];

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * Pure: compare the three address sources. Returns { ok, errors, warnings } so callers
 * (and tests) can assert on individual drift instead of parsing text.
 */
export function compareAddressSources({ manifest, status, verification }) {
  const errors = [];
  const warnings = [];

  if (Number(manifest?.chainId) !== 46630) errors.push(`manifest chainId is ${manifest?.chainId}, expected 46630`);
  if (Number(status?.chainId) !== 46630) errors.push(`status chainId is ${status?.chainId}, expected 46630`);

  const statusContracts = status?.contracts ?? {};
  for (const key of MANIFEST_CONTRACT_KEYS) {
    if (!manifest?.[key]) {
      errors.push(`manifest is missing ${key}`);
      continue;
    }
    if (!statusContracts[key]) {
      errors.push(`testnet-status is missing ${key}`);
      continue;
    }
    if (!same(manifest[key], statusContracts[key])) {
      errors.push(`${key} drift: manifest ${manifest[key]} vs status ${statusContracts[key]}`);
    }
  }
  if (manifest?.permit2 && statusContracts.permit2 && !same(manifest.permit2, statusContracts.permit2)) {
    errors.push(`permit2 drift: manifest ${manifest.permit2} vs status ${statusContracts.permit2}`);
  }

  if (!verification) {
    errors.push('verification evidence is missing');
    return { ok: false, errors, warnings };
  }
  if (Number(verification.chainId) !== Number(manifest?.chainId)) {
    errors.push(`verification chainId ${verification.chainId} does not match manifest ${manifest?.chainId}`);
  }
  if (!same(verification.deployer, manifest?.deployer)) {
    errors.push(`verification deployer ${verification.deployer} does not match manifest ${manifest?.deployer}`);
  }
  if (!verification.sourceCommit) warnings.push('verification has no sourceCommit: cannot tell which tree produced it');

  for (const key of MANIFEST_CONTRACT_KEYS) {
    const recorded = verification.contracts?.[key];
    if (!recorded) {
      errors.push(`verification does not cover ${key}`);
      continue;
    }
    if (!same(recorded.address, manifest?.[key])) {
      errors.push(`${key} drift: manifest ${manifest?.[key]} vs verification ${recorded.address}`);
    }
    if (!Number.isInteger(recorded.codeBytes) || recorded.codeBytes <= 0) {
      errors.push(`verification records no code size for ${key}`);
    }
  }
  if (verification.contracts?.feeToken && manifest?.feeToken
      && !same(verification.contracts.feeToken.address, manifest.feeToken)) {
    errors.push(`feeToken drift: manifest ${manifest.feeToken} vs verification ${verification.contracts.feeToken.address}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Pure: compare recorded code sizes against what the chain reports. */
export function compareCodeSizes({ verification, actualSizes }) {
  const errors = [];
  for (const [key, recorded] of Object.entries(verification?.contracts ?? {})) {
    const actual = actualSizes?.[key];
    if (actual === undefined) {
      errors.push(`no on-chain code measured for ${key}`);
      continue;
    }
    if (actual === 0) {
      errors.push(`${key} has no code at ${recorded.address}`);
      continue;
    }
    if (Number.isInteger(recorded.codeBytes) && recorded.codeBytes !== actual) {
      errors.push(`${key} code size drift: recorded ${recorded.codeBytes} vs on-chain ${actual}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export async function loadSources() {
  const manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8'));
  const verification = JSON.parse(await readFile(VERIFICATION_URL, 'utf8'));
  return { manifest, status: TESTNET, verification };
}

async function measureCode(publicClient, verification) {
  const sizes = {};
  for (const [key, recorded] of Object.entries(verification.contracts ?? {})) {
    const code = await publicClient.getBytecode({ address: recorded.address });
    sizes[key] = code ? (code.length - 2) / 2 : 0;
  }
  return sizes;
}

async function main() {
  const withRpc = process.argv.includes('--rpc');
  const { manifest, status, verification } = await loadSources();

  const structural = compareAddressSources({ manifest, status, verification });
  const { manifestHash } = formatDeployManifest(manifest);
  const hashMatches = verification.manifestHash === manifestHash;

  const lines = [
    `manifest chainId ${manifest.chainId}, ${MANIFEST_CONTRACT_KEYS.length} contracts, hash ${manifestHash.slice(0, 18)}...`,
    `verification sourceCommit ${verification.sourceCommit ?? 'MISSING'}, manifestHash ${hashMatches ? 'matches' : 'MISMATCH'}`
  ];

  const errors = [...structural.errors];
  if (!hashMatches) {
    errors.push(`verification manifestHash ${verification.manifestHash} does not match the manifest (${manifestHash})`);
  }

  if (withRpc) {
    const env = {};
    try {
      const content = await readFile(new URL('../../.env', import.meta.url), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
      }
    } catch {
      // process.env fallback below
    }
    const rpcUrl = process.env.RH_TESTNET_RPC_PRIMARY || env.RH_TESTNET_RPC_PRIMARY;
    if (!rpcUrl) throw new Error('RH_TESTNET_RPC_PRIMARY is required for --rpc');
    const publicClient = createPublicClient({ transport: http(rpcUrl) });
    const chainId = await publicClient.getChainId();
    if (chainId !== 46630) throw new Error(`RPC answered chainId ${chainId}, expected 46630`);
    const sizes = await measureCode(publicClient, verification);
    const codeCheck = compareCodeSizes({ verification, actualSizes: sizes });
    errors.push(...codeCheck.errors);
    lines.push(`on-chain code verified for ${Object.keys(sizes).length} addresses`);
  }

  for (const warning of structural.warnings) console.warn(`WARN ${warning}`);
  if (errors.length > 0) {
    console.error('DRIFT DETECTED');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  for (const line of lines) console.log(`OK   ${line}`);
}

if (process.argv[1] && process.argv[1].endsWith('check-testnet-addresses.mjs')) {
  main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
