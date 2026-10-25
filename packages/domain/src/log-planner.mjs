const ABSOLUTE_MAX_CALLS = 24;
const ABSOLUTE_MAX_RANGE = 10n;

export function planBoundedLogRanges(shards, { maxCalls = 24, maxRange = 10 } = {}) {
  if (!Array.isArray(shards) || shards.length === 0 || shards.length > 2) {
    throw new RangeError('log planner accepts one or two shards');
  }
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > ABSOLUTE_MAX_CALLS) {
    throw new RangeError(`maxCalls must be between one and ${ABSOLUTE_MAX_CALLS}`);
  }
  if (!Number.isInteger(maxRange) || maxRange < 1 || BigInt(maxRange) > ABSOLUTE_MAX_RANGE) {
    throw new RangeError('maxRange must be between one and ten inclusive');
  }

  const seenIds = new Set();
  const state = shards.map((shard) => {
    if (typeof shard?.id !== 'string' || shard.id.trim() === '' || seenIds.has(shard.id)) {
      throw new TypeError('each log shard requires a unique non-empty id');
    }
    seenIds.add(shard.id);
    if (typeof shard.fromBlock !== 'bigint' || typeof shard.toBlock !== 'bigint'
      || shard.fromBlock < 0n || shard.toBlock < 0n) {
      throw new TypeError('log shard block numbers must be non-negative bigint values');
    }
    if (shard.done === true) {
      if (shard.fromBlock <= shard.toBlock) throw new RangeError('completed shard cursor must be beyond its inclusive end');
    } else if (shard.fromBlock > shard.toBlock) {
      throw new RangeError('log range must have fromBlock <= toBlock unless explicitly complete');
    }
    return { ...shard, nextBlock: shard.fromBlock, done: shard.done === true };
  });

  const calls = [];
  while (calls.length < maxCalls && state.some((shard) => !shard.done)) {
    for (const shard of state) {
      if (calls.length >= maxCalls) break;
      if (shard.done) continue;
      const fromBlock = shard.nextBlock;
      const toBlock = fromBlock + BigInt(maxRange) - 1n < shard.toBlock
        ? fromBlock + BigInt(maxRange) - 1n : shard.toBlock;
      calls.push(Object.freeze({ shardId: shard.id, fromBlock, toBlock }));
      shard.nextBlock = toBlock + 1n;
      shard.done = shard.nextBlock > shard.toBlock;
    }
  }

  const nextShards = state.map((shard) => Object.freeze({
    id: shard.id,
    fromBlock: shard.done ? shard.toBlock + 1n : shard.nextBlock,
    toBlock: shard.toBlock,
    done: shard.done,
  }));
  const remainingBlocks = state.reduce((total, shard) => total + (shard.done ? 0n : shard.toBlock - shard.nextBlock + 1n), 0n);
  return Object.freeze({
    calls: Object.freeze(calls),
    nextShards: Object.freeze(nextShards),
    complete: state.every((shard) => shard.done),
    remainingBlocks,
  });
}
