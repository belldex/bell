// Indexer canonical ingest, reorg reconciliation and finality projection
// (plan M10-02/M10-03/M10-04, brief G35/G36/G37). Pure decision logic; the DB
// writes live in the indexer function and must commit before checkpoints move.
export function eventIdentity(event) {
  const { chainId, blockHash, txHash, logIndex } = event ?? {};
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError('chainId must be a positive integer');
  if (typeof blockHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(blockHash)) throw new RangeError('blockHash must be a 32-byte hex hash');
  if (typeof txHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(txHash)) throw new RangeError('txHash must be a 32-byte hex hash');
  if (!Number.isSafeInteger(logIndex) || logIndex < 0) throw new RangeError('logIndex must be a non-negative integer');
  return { chainId, blockHash, txHash, logIndex };
}

export function identityKey(event) {
  const identity = eventIdentity(event);
  return [`chain:${identity.chainId}`, identity.blockHash, identity.txHash, `log:${identity.logIndex}`].join('|');
}

// Ingest is idempotent: replaying a batch (crash after commit, retry) must not
// double-count fees/positions. Checkpoints may only advance for a contiguous
// range AFTER the batch commits (the caller proves that with committed=true).
export function planIngest({ batch, ingestedKeys, checkpoint, committed = false }) {
  if (!Array.isArray(batch)) throw new TypeError('batch must be an array of logs');
  if (!(checkpoint && Number.isSafeInteger(checkpoint.blockNumber) && typeof checkpoint.blockHash === 'string')) {
    throw new TypeError('checkpoint { blockNumber, blockHash } is required');
  }
  const known = new Set(ingestedKeys ?? []);
  const fresh = [];
  let duplicates = 0;
  for (const event of batch) {
    const key = identityKey(event);
    if (known.has(key)) {
      duplicates += 1;
      continue;
    }
    known.add(key);
    fresh.push(event);
  }
  const last = batch.length ? batch[batch.length - 1] : null;
  const contiguous = last !== null
    && Number.isSafeInteger(last.blockNumber)
    && last.blockNumber > checkpoint.blockNumber
    && last.parentHash === checkpoint.blockHash;
  const nextCheckpoint = committed && contiguous
    ? { blockNumber: last.blockNumber, blockHash: last.blockHash }
    : checkpoint;
  return { fresh, duplicates, nextCheckpoint, advanced: nextCheckpoint !== checkpoint };
}

// Reorg reconciliation: find the last common ancestor between the checkpoint
// lineage and each provider lineage. Any unresolved disagreement stops signing
// that requires provider agreement instead of guessing a canonical head.
export function findCommonAncestor(checkpoint, providerHeads) {
  if (!Array.isArray(providerHeads) || providerHeads.length === 0) {
    throw new TypeError('providerHeads must be a non-empty array');
  }
  const lineage = (head) => {
    const map = new Map();
    let cursor = head;
    while (cursor) {
      map.set(cursor.blockNumber, cursor.blockHash);
      cursor = cursor.parent;
    }
    return map;
  };
  const base = lineage(checkpoint);
  const common = providerHeads.map((head) => {
    const theirs = lineage(head);
    let best = null;
    for (const [number, hash] of base) {
      if (theirs.get(number) === hash && (best === null || number > best.blockNumber)) {
        best = { blockNumber: number, blockHash: hash };
      }
    }
    return best;
  });
  if (common.some((ancestor) => ancestor === null)) return { resolved: false, ancestor: null };
  const deepest = common.reduce((a, b) => (a.blockNumber <= b.blockNumber ? a : b));
  return { resolved: true, ancestor: deepest, depth: checkpoint.blockNumber - deepest.blockNumber };
}

// Rollback plan for a reorg: events above the ancestor are orphaned, then
// bounded canonical ranges replay. Projections must roll back in the same
// transaction as the delete, before replay (caller responsibility).
export function planReplay({ ancestor, orphans, canonicalRanges, maxRange }) {
  if (!ancestor || !Number.isSafeInteger(ancestor.blockNumber)) throw new TypeError('ancestor block is required');
  if (!Array.isArray(orphans)) throw new TypeError('orphans must be an array');
  if (!Array.isArray(canonicalRanges)) throw new TypeError('canonicalRanges must be an array of {fromBlock, toBlock}');
  if (!Number.isSafeInteger(maxRange) || maxRange < 1) throw new RangeError('maxRange must be a positive integer');
  const orphanKeys = orphans.map(identityKey);
  const ranges = [];
  for (const range of canonicalRanges) {
    const { fromBlock, toBlock } = range;
    if (!Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(toBlock) || toBlock < fromBlock) {
      throw new RangeError('canonical ranges must be ascending block spans');
    }
    if (fromBlock <= ancestor.blockNumber) throw new RangeError('replay must start above the common ancestor');
    for (let start = fromBlock; start <= toBlock; start += maxRange) {
      ranges.push({ fromBlock: start, toBlock: Math.min(start + maxRange - 1, toBlock) });
    }
  }
  return { orphanKeys, replayRanges: ranges };
}

// Finality projection: one receipt or a local block count never makes a
// transaction finalized. Without an agreed finalized tag the honest state is
// CONFIRMED_UNFINALIZED.
export const TX_STATES = Object.freeze({
  PENDING: 'PENDING',
  PROVISIONAL: 'PROVISIONAL',
  CONFIRMED_UNFINALIZED: 'CONFIRMED_UNFINALIZED',
  FINALIZED: 'FINALIZED',
  REPLACED: 'REPLACED',
  REVERTED: 'REVERTED',
  ORPHANED: 'ORPHANED',
});

export function projectFinality({ receipt, finalizedTag, providerAgreement, reorged }) {
  if (reorged) return TX_STATES.ORPHANED;
  if (!receipt || receipt.mined !== true) return TX_STATES.PENDING;
  if (receipt.status === 0) return TX_STATES.REVERTED;
  if (receipt.replaced === true) return TX_STATES.REPLACED;
  if (finalizedTag === true && providerAgreement === true) return TX_STATES.FINALIZED;
  return TX_STATES.CONFIRMED_UNFINALIZED;
}

// Side effects that require finality must hold back unless FINALIZED.
export function requiresFinality(state) {
  return state !== TX_STATES.FINALIZED;
}
