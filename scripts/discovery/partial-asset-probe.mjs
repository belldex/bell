import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { functionSelector, hashEvmCode } from '../../packages/protocol/src/identity.mjs';
import { compareAtCommonBlock, probeChainHead } from './rpc-preflight.mjs';

const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SELECTOR = Object.freeze({
  decimals: functionSelector('decimals()'),
  aggregator: functionSelector('aggregator()'),
  uiMultiplier: functionSelector('uiMultiplier()'),
  newUIMultiplier: functionSelector('newUIMultiplier()'),
  effectiveAt: functionSelector('effectiveAt()'),
  oraclePaused: functionSelector('oraclePaused()'),
});

function word(hex, label) {
  if (typeof hex !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hex)) throw new Error(`${label}: malformed uint256 response`);
  return BigInt(hex);
}

function addressWord(hex, label) {
  const value = word(hex, label);
  if (value >> 160n) throw new Error(`${label}: noncanonical ABI address`);
  return `0x${value.toString(16).padStart(40, '0')}`;
}

async function readCode(client, address, blockTag) {
  if (!ADDRESS.test(address ?? '') || address.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { ok: false, reason: 'INVALID_ADDRESS' };
  }
  const code = await client.call('eth_getCode', [address, blockTag]);
  if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(code)) return { ok: false, reason: 'MALFORMED_CODE' };
  const present = code !== '0x';
  return { ok: present, codeHash: present ? hashEvmCode(code) : null, reason: present ? null : 'NO_CODE' };
}

async function readCall(client, to, selector, blockTag, label) {
  return client.call('eth_call', [{ to, data: selector }, blockTag]).then((value) => word(value, label));
}

async function probeFeed(client, name, feed, blockTag) {
  const proxy = await readCode(client, feed.proxy, blockTag);
  const result = { name, proxy: feed.proxy, proxyCodePresent: proxy.ok, proxyCodeHash: proxy.codeHash };
  if (!proxy.ok) return { ...result, decimalsMatches: false, implementation: null, implementationCodePresent: false };
  try {
    const observedDecimals = await readCall(client, feed.proxy, SELECTOR.decimals, blockTag, `${name}.decimals`);
    result.observedDecimals = observedDecimals.toString();
    result.decimalsMatches = observedDecimals === BigInt(feed.decimals);
  } catch {
    result.decimalsMatches = false;
  }
  try {
    const implementation = addressWord(
      `0x${(await readCall(client, feed.proxy, SELECTOR.aggregator, blockTag, `${name}.aggregator`)).toString(16).padStart(64, '0')}`,
      `${name}.aggregator`,
    );
    const implementationCode = await readCode(client, implementation, blockTag);
    return {
      ...result,
      implementation,
      implementationCodePresent: implementationCode.ok,
      implementationCodeHash: implementationCode.codeHash,
    };
  } catch {
    return { ...result, implementation: null, implementationCodePresent: false };
  }
}

async function probeStockToken(client, asset, blockTag) {
  const code = await readCode(client, asset.token, blockTag);
  const result = { symbol: asset.symbol, token: asset.token, codePresent: code.ok, codeHash: code.codeHash };
  if (!code.ok) return { ...result, decimalsMatches: false, corporateStatus: null };
  try {
    const decimals = await readCall(client, asset.token, SELECTOR.decimals, blockTag, `${asset.symbol}.decimals`);
    result.observedDecimals = decimals.toString();
    result.decimalsMatches = decimals === BigInt(asset.decimals);
  } catch {
    result.decimalsMatches = false;
  }
  try {
    const [multiplier, pendingMultiplier, effectiveAt, oraclePaused] = await Promise.all([
      readCall(client, asset.token, SELECTOR.uiMultiplier, blockTag, `${asset.symbol}.uiMultiplier`),
      readCall(client, asset.token, SELECTOR.newUIMultiplier, blockTag, `${asset.symbol}.newUIMultiplier`),
      readCall(client, asset.token, SELECTOR.effectiveAt, blockTag, `${asset.symbol}.effectiveAt`),
      readCall(client, asset.token, SELECTOR.oraclePaused, blockTag, `${asset.symbol}.oraclePaused`),
    ]);
    if (oraclePaused > 1n || multiplier === 0n || pendingMultiplier === 0n || effectiveAt > (1n << 64n) - 1n) {
      throw new Error('malformed corporate getter values');
    }
    result.corporateStatus = {
      multiplier18: multiplier.toString(),
      pendingMultiplier18: pendingMultiplier.toString(),
      effectiveAt: effectiveAt.toString(),
      oraclePaused: oraclePaused === 1n,
    };
  } catch {
    result.corporateStatus = null;
  }
  return result;
}

export async function probeAssetCandidatesAtBlock({ client, candidates, expectedChainId, commonBlock = null }) {
  if (!client || !['alchemy', 'pinax'].includes(client.provider) || typeof client.call !== 'function') {
    throw new TypeError('candidate probe requires an authenticated Alchemy or Pinax client');
  }
  if (!candidates || typeof candidates !== 'object' || !Array.isArray(candidates.assets)) {
    throw new TypeError('documented candidate asset list is required');
  }
  const head = commonBlock
    ? { provider: client.provider, chainId: expectedChainId, blockNumber: BigInt(commonBlock.number), blockHash: commonBlock.hash }
    : await probeChainHead(client, expectedChainId);
  const blockTag = `0x${head.blockNumber.toString(16)}`;
  const assets = await Promise.all(candidates.assets.map((asset) => probeStockToken(client, asset, blockTag)));
  const feedsToProbe = [];
  for (const [name, feed] of Object.entries(candidates.quoteFeeds ?? {})) feedsToProbe.push([name, feed]);
  for (const asset of candidates.assets) {
    if (asset.directAdjustedTokenUsd) feedsToProbe.push([`${asset.symbol}_ADJUSTED_USD`, asset.directAdjustedTokenUsd]);
  }
  const feeds = await Promise.all(feedsToProbe.map(([name, feed]) => probeFeed(client, name, feed, blockTag)));
  const verifier = candidates.verifier?.address ? await readCode(client, candidates.verifier.address, blockTag) : { ok: false, reason: 'MISSING_VERIFIER' };
  const mismatches = [
    ...assets.flatMap((asset) => [
      ...(!asset.codePresent ? [`${asset.symbol}:NO_CODE`] : []),
      ...(!asset.decimalsMatches ? [`${asset.symbol}:DECIMALS`] : []),
      ...(!asset.corporateStatus ? [`${asset.symbol}:CORPORATE_GETTERS`] : []),
    ]),
    ...feeds.flatMap((feed) => [
      ...(!feed.proxyCodePresent ? [`${feed.name}:NO_PROXY_CODE`] : []),
      ...(!feed.decimalsMatches ? [`${feed.name}:DECIMALS`] : []),
      ...(!feed.implementationCodePresent ? [`${feed.name}:NO_IMPLEMENTATION_CODE`] : []),
    ]),
    ...(!verifier.ok ? ['VERIFIER:NO_CODE'] : []),
  ];
  return Object.freeze({
    schemaVersion: 1,
    kind: 'ASSET_CANDIDATE_PARTIAL_PREFLIGHT',
    status: mismatches.length === 0 ? `PARTIAL_${client.provider.toUpperCase()}_ONLY` : 'CANDIDATE_MISMATCH',
    provider: client.provider,
    network: candidates.network?.name ?? 'unknown',
    chainId: head.chainId,
    block: Object.freeze({ number: head.blockNumber.toString(), hash: head.blockHash }),
    assets: Object.freeze(assets),
    feeds: Object.freeze(feeds),
    verifier: Object.freeze({ address: candidates.verifier?.address ?? null, codePresent: verifier.ok, codeHash: verifier.codeHash }),
    mismatches: Object.freeze(mismatches),
    providersAgree: false,
    admissionGranted: false,
    limitations: Object.freeze([
      'Single-provider reads are preliminary and do not verify a common block against an independent provider.',
      'Public metadata and code presence do not establish source entitlement, report signatures, redistribution rights, or token admission.',
    ]),
  });
}

export async function probeAssetCandidatesAlchemy({ client, candidates, expectedChainId }) {
  if (client?.provider !== 'alchemy') throw new TypeError('candidate probe requires an authenticated Alchemy client');
  return probeAssetCandidatesAtBlock({ client, candidates, expectedChainId });
}

function candidateObservation(result) {
  return JSON.stringify({ assets: result.assets, feeds: result.feeds, verifier: result.verifier, mismatches: result.mismatches });
}

export async function probeAssetCandidatesWithCrossCheck({ primary, secondary, candidates, expectedChainId }) {
  if (!primary || primary.provider !== 'alchemy' || !secondary || secondary.provider !== 'pinax') {
    throw new TypeError('candidate cross-check requires Alchemy primary and Pinax secondary clients');
  }
  const [headA, headB] = await Promise.all([
    probeChainHead(primary, expectedChainId),
    probeChainHead(secondary, expectedChainId),
  ]);
  const comparison = await compareAtCommonBlock(primary, headA, secondary, headB);
  if (!comparison.agree) {
    return Object.freeze({
      schemaVersion: 1,
      kind: 'ASSET_CANDIDATE_DUAL_PROVIDER_PREFLIGHT',
      status: comparison.reason === 'BLOCK_HASH_MISMATCH' ? 'PROVIDER_DISAGREEMENT' : 'COMMON_BLOCK_UNAVAILABLE',
      providersAgree: false,
      candidateReadsAgree: false,
      commonBlock: comparison.blockNumber === undefined ? null : { number: comparison.blockNumber.toString(), hash: null },
      admissionGranted: false,
      reason: comparison.reason,
    });
  }
  const commonBlock = { number: comparison.blockNumber.toString(), hash: comparison.blockHash };
  const [resultA, resultB] = await Promise.all([
    probeAssetCandidatesAtBlock({ client: primary, candidates, expectedChainId, commonBlock }),
    probeAssetCandidatesAtBlock({ client: secondary, candidates, expectedChainId, commonBlock }),
  ]);
  const candidateReadsAgree = candidateObservation(resultA) === candidateObservation(resultB);
  return Object.freeze({
    schemaVersion: 1,
    kind: 'ASSET_CANDIDATE_DUAL_PROVIDER_PREFLIGHT',
    status: candidateReadsAgree ? 'CROSS_CHECKED_NOT_ADMITTED' : 'CANDIDATE_READ_MISMATCH',
    network: candidates.network?.name ?? 'unknown',
    chainId: expectedChainId,
    providersAgree: true,
    candidateReadsAgree,
    commonBlock: Object.freeze(commonBlock),
    providerResults: Object.freeze([
      Object.freeze({
        provider: 'alchemy', status: resultA.status, mismatches: resultA.mismatches,
        observations: Object.freeze({ assets: resultA.assets, feeds: resultA.feeds, verifier: resultA.verifier }),
      }),
      Object.freeze({
        provider: 'pinax', status: resultB.status, mismatches: resultB.mismatches,
        observations: Object.freeze({ assets: resultB.assets, feeds: resultB.feeds, verifier: resultB.verifier }),
      }),
    ]),
    admissionGranted: false,
    limitations: Object.freeze([
      'Same-block agreement verifies RPC observations only; it does not establish source entitlement, report-signature rights, or token admission.',
      'No transaction was constructed or broadcast by this preflight.',
    ]),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const network = process.argv[2] ?? 'mainnet';
  if (network !== 'mainnet') throw new Error('Only the documented mainnet candidate bundle is currently available');
  const primaryEndpoint = process.env.RH_MAINNET_RPC_PRIMARY;
  const secondaryEndpoint = process.env.RH_MAINNET_RPC_SECONDARY;
  if (!primaryEndpoint || !secondaryEndpoint) throw new Error('Both RH_MAINNET_RPC_PRIMARY and RH_MAINNET_RPC_SECONDARY are required');
  const { createRpcClient } = await import('./rpc-client.mjs');
  const candidates = JSON.parse(await readFile(resolve('config/assets/candidates.mainnet.json'), 'utf8'));
  const result = await probeAssetCandidatesWithCrossCheck({
    primary: createRpcClient({ provider: 'alchemy', networkType: 'mainnet', endpoint: primaryEndpoint }),
    secondary: createRpcClient({ provider: 'pinax', networkType: 'mainnet', endpoint: secondaryEndpoint }),
    candidates,
    expectedChainId: 4663,
  });
  console.log(JSON.stringify(result, null, 2));
}
