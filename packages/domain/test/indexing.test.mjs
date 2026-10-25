import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planIngest, findCommonAncestor, planReplay, projectFinality, requiresFinality, TX_STATES, identityKey,
} from '../src/indexing.mjs';

const H = (n) => '0x' + n.toString(16).padStart(64, '0');
const log = (block, hashN, logIndex, parentHashN) => ({
  chainId: 4663, blockNumber: block, blockHash: H(hashN), parentHash: H(parentHashN ?? hashN - 1),
  txHash: H(0x1000 + hashN), logIndex,
});

test('identity binds chainId/blockHash/txHash/logIndex and rejects malformed logs', () => {
  assert.throws(() => identityKey({ chainId: 0, blockHash: H(1), txHash: H(2), logIndex: 0 }), /chainId/);
  assert.throws(() => identityKey({ chainId: 1, blockHash: '0x1234', txHash: H(2), logIndex: 0 }), /blockHash/);
  assert.throws(() => identityKey({ chainId: 1, blockHash: H(1), txHash: H(2), logIndex: -1 }), /logIndex/);
  assert.equal(identityKey(log(5, 5, 0)), 'chain:4663|' + H(5) + '|' + H(0x1005) + '|log:0');
});

test('ingest is idempotent: replaying a committed batch yields zero fresh events', () => {
  const batch = [log(6, 6, 0), log(6, 6, 1)];
  const first = planIngest({ batch, checkpoint: { blockNumber: 5, blockHash: H(5) }, committed: true });
  assert.equal(first.fresh.length, 2);
  assert.equal(first.advanced, true);
  assert.deepEqual(first.nextCheckpoint, { blockNumber: 6, blockHash: H(6) });
  const replay = planIngest({
    batch,
    ingestedKeys: first.fresh.map(identityKey),
    checkpoint: first.nextCheckpoint,
    committed: true,
  });
  assert.equal(replay.fresh.length, 0);
  assert.equal(replay.duplicates, 2);
});

test('checkpoint never advances without a contiguous parent link or before commit', () => {
  const batch = [log(6, 6, 0)];
  const uncommitted = planIngest({ batch, checkpoint: { blockNumber: 5, blockHash: H(5) }, committed: false });
  assert.equal(uncommitted.advanced, false);
  const gap = planIngest({ batch: [log(7, 7, 0)], checkpoint: { blockNumber: 5, blockHash: H(5) }, committed: true });
  assert.equal(gap.advanced, false);
});

test('partial DB failure does not hide missing events: dedupe keys include blockHash', () => {
  const canonical = log(6, 6, 0);
  const orphanSameHeight = log(6, 0xaa, 0);
  assert.notEqual(identityKey(canonical), identityKey(orphanSameHeight));
});

test('common ancestor is the deepest agreed hash and multi-provider disagreement blocks resolution', () => {
  const checkpoint = { blockNumber: 10, blockHash: H(10), parent: { blockNumber: 9, blockHash: H(9) } };
  const agree = { blockNumber: 11, blockHash: H(0xb1), parent: { blockNumber: 10, blockHash: H(10) } };
  const reorged = { blockNumber: 11, blockHash: H(0xb2), parent: { blockNumber: 9, blockHash: H(9) } };
  const ok = findCommonAncestor(checkpoint, [agree, { blockNumber: 12, blockHash: H(0xc), parent: agree }]);
  assert.deepEqual(ok.ancestor, { blockNumber: 10, blockHash: H(10) });
  assert.equal(ok.depth, 0);
  const blocked = findCommonAncestor(checkpoint, [agree, reorged]);
  // deepest common across providers is 9
  assert.deepEqual(blocked.ancestor, { blockNumber: 9, blockHash: H(9) });
  assert.equal(blocked.depth, 1);
  const lost = findCommonAncestor(checkpoint, [{ blockNumber: 11, blockHash: H(0xf1), parent: { blockNumber: 10, blockHash: H(0xf0) } }]);
  assert.equal(lost.resolved, false);
  assert.equal(lost.ancestor, null);
});

test('replay plan chunks bounded ranges strictly above the ancestor', () => {
  const plan = planReplay({
    ancestor: { blockNumber: 9, blockHash: H(9) },
    orphans: [log(10, 0xaa, 0), log(11, 0xbb, 0)],
    canonicalRanges: [{ fromBlock: 10, toBlock: 24 }],
    maxRange: 10,
  });
  assert.equal(plan.orphanKeys.length, 2);
  assert.deepEqual(plan.replayRanges, [
    { fromBlock: 10, toBlock: 19 },
    { fromBlock: 20, toBlock: 24 },
  ]);
  assert.throws(() => planReplay({
    ancestor: { blockNumber: 20, blockHash: H(20) },
    orphans: [], canonicalRanges: [{ fromBlock: 10, toBlock: 24 }], maxRange: 10,
  }), /above the common ancestor/);
});

test('finality: one receipt or a local count never yields FINALIZED', () => {
  const receipt = { mined: true, status: 1 };
  assert.equal(projectFinality({ receipt, finalizedTag: false, providerAgreement: true }), TX_STATES.CONFIRMED_UNFINALIZED);
  assert.equal(projectFinality({ receipt, finalizedTag: true, providerAgreement: false }), TX_STATES.CONFIRMED_UNFINALIZED);
  assert.equal(projectFinality({ receipt, finalizedTag: true, providerAgreement: true }), TX_STATES.FINALIZED);
  assert.equal(projectFinality({ receipt: { mined: true, status: 0 } }), TX_STATES.REVERTED);
  assert.equal(projectFinality({ receipt: { mined: true, status: 1, replaced: true } }), TX_STATES.REPLACED);
  assert.equal(projectFinality({ receipt, reorged: true }), TX_STATES.ORPHANED);
  assert.equal(projectFinality({}), TX_STATES.PENDING);
});

test('side effects that require finality are held for every non-final state', () => {
  for (const state of Object.values(TX_STATES)) {
    assert.equal(requiresFinality(state), state !== TX_STATES.FINALIZED);
  }
});
