// API read routes: katalog, policy, transaction state (plan M08-02, G29/G36/G37).
// Reads share a common block identity: mixing 'latest' from two providers is
// forbidden. Cache can never authorize a swap; empty/unavailable/conflict
// have distinct statuses, and big numbers cross as strings.
import { envelope, validateHash, ValidationError } from './api-schema.mjs';

export function readAssets({ chainId, assets, observedBlockNumber, observedBlockHash, observedAt, requestId, cursor, limit }) {
  const sorted = [...assets].sort((a, b) => (a.descriptorId < b.descriptorId ? -1 : 1));
  const found = cursor === undefined ? 0 : sorted.findIndex((a) => a.descriptorId === cursor);
  if (cursor !== undefined && found < 0) throw new ValidationError('cursor', 'unknown cursor');
  const start = cursor === undefined ? 0 : found + 1;
  const page = sorted.slice(start, start + limit);
  const nextCursor = start + limit < sorted.length ? page[page.length - 1].descriptorId : null;
  return envelope({
    chainId, observedBlockNumber, observedBlockHash, observedAt, requestId,
    extra: {
      assets: page.map((a) => ({
        descriptorId: a.descriptorId,
        tokenAddress: a.tokenAddress,
        admitted: a.admitted === true,
        class: a.class,
        capabilities: a.capabilities,
        sourceMetadata: a.publicSourceMetadata ?? null,
      })),
      nextCursor,
    },
  });
}

export function readPolicy({ chainId, poolId, onchainPolicy, observedBlockNumber, observedBlockHash, observedAt, requestId }) {
  if (onchainPolicy === null) {
    // Unknown pool is a 404-shaped typed error, never an empty healthy policy.
    return { http: 404, body: errorNotFound('pool', poolId) };
  }
  return envelope({
    chainId, observedBlockNumber, observedBlockHash, observedAt, requestId,
    extra: {
      poolId,
      configHash: onchainPolicy.configHash,
      class: onchainPolicy.class,
      lifecycle: onchainPolicy.lifecycle,
      referenceMode: onchainPolicy.referenceMode,
      effectiveLpFee: onchainPolicy.effectiveLpFee,
      reasons: onchainPolicy.reasons,
      budgets: onchainPolicy.budgets,
      canSwap: onchainPolicy.canSwap,
      disclaimer: 'canSwap is not an amount guarantee; state can change before execution.',
    },
  });
}

export function readTransaction({ chainId, txHash, indexed, observedAt, requestId }) {
  validateHash(txHash, 'txHash');
  if (indexed === null || indexed === undefined) {
    return { http: 404, body: errorNotFound('transaction', txHash) };
  }
  return envelope({
    chainId, observedBlockNumber: indexed.observedBlockNumber,
    observedBlockHash: indexed.observedBlockHash, observedAt, requestId,
    extra: {
      txHash,
      state: indexed.state,
      receipt: indexed.receipt ?? null,
      reorgState: indexed.reorgState ?? 'NONE',
    },
  });
}

function errorNotFound(kind, id) {
  return {
    apiVersion: 'v1',
    error: { kind: 'NOT_FOUND', http: 404, code: 'NOT_FOUND', message: kind + ' not found', field: null, retryAfter: null, requestId: null, id },
  };
}