import test from 'node:test';
import assert from 'node:assert/strict';
import { hashCalendarLeaf, hashSortedPair, verifyMerkleProof, validateCalendarPartition } from '../src/calendar.mjs';
import vector from '../../test-vectors/runtime-compat.json' with { type: 'json' };

const leaf = (index, start, end, phase = 2) => ({
  chainId: 4663n,
  calendarRegistry: '0x1111111111111111111111111111111111111111',
  assetId: `0x${'a'.repeat(64)}`,
  year: 2026,
  index,
  start: BigInt(start),
  end: BigInt(end),
  phase,
  provenanceHash: `0x${'b'.repeat(64)}`,
});

test('domain-separates calendar leaf hashes and binds all committed identity fields', () => {
  const a = hashCalendarLeaf(leaf(0, 100, 200));
  assert.match(a, /^0x[0-9a-f]{64}$/);
  assert.notEqual(a, hashCalendarLeaf(leaf(1, 100, 200)));
  assert.notEqual(a, hashCalendarLeaf({ ...leaf(0, 100, 200), chainId: 46630n }));
});

test('matches the shared ABI/Keccak calendar vector', () => {
  const item = vector.calendarLeaf;
  assert.equal(hashCalendarLeaf({
    ...item,
    chainId: BigInt(item.chainId),
    start: BigInt(item.start),
    end: BigInt(item.end),
  }), item.expectedHash);
});

test('sorted-pair Merkle proof is order independent and tampering fails', () => {
  const first = hashCalendarLeaf(leaf(0, 100, 200));
  const second = hashCalendarLeaf(leaf(1, 200, 300));
  const root = hashSortedPair(first, second);
  assert.equal(verifyMerkleProof(first, [second], root), true);
  assert.equal(verifyMerkleProof(second, [first], root), true);
  assert.equal(verifyMerkleProof(first, [`0x${'0'.repeat(64)}`], root), false);
});

test('validates full interval coverage with no gaps, overlap, bad order, or unsupported phase', () => {
  assert.equal(validateCalendarPartition([leaf(0, 100, 200), leaf(1, 200, 300, 5)], 100n, 300n).valid, true);
  assert.equal(validateCalendarPartition([leaf(0, 100, 200), leaf(1, 201, 300)], 100n, 300n).valid, false);
  assert.equal(validateCalendarPartition([leaf(0, 100, 200), leaf(1, 199, 300)], 100n, 300n).valid, false);
  assert.equal(validateCalendarPartition([leaf(1, 100, 200), leaf(0, 200, 300)], 100n, 300n).valid, false);
  assert.equal(validateCalendarPartition([leaf(0, 100, 200, 0)], 100n, 200n).valid, false);
});

test('a root partition cannot mix asset, year, chain, or registry identities', () => {
  for (const changed of [
    { year: 2027 }, { assetId: `0x${'c'.repeat(64)}` },
    { chainId: 46630n }, { calendarRegistry: '0x2222222222222222222222222222222222222222' },
  ]) {
    assert.equal(validateCalendarPartition([leaf(0, 100, 200), { ...leaf(1, 200, 300), ...changed }], 100n, 300n).valid, false);
  }
});

test('rejects zero-valued calendar leaf identity sentinels', () => {
  const zero = `0x${'0'.repeat(64)}`;
  for (const changed of [
    { calendarRegistry: '0x0000000000000000000000000000000000000000' },
    { assetId: zero }, { provenanceHash: zero },
  ]) {
    assert.throws(() => hashCalendarLeaf({ ...leaf(0, 100, 200), ...changed }));
    assert.equal(validateCalendarPartition([{ ...leaf(0, 100, 200), ...changed }], 100n, 200n).valid, false);
  }
});
