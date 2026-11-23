import test from 'node:test';
import assert from 'node:assert/strict';
import { hashCalendarLeaf, verifyMerkleProof, validateCalendarPartition } from '../../packages/protocol/src/calendar.mjs';
import { buildCalendarDataset } from './calendar-builder.mjs';
import { carveEventWindows, describeEventWindows } from './event-windows.mjs';

const hash = (c) => `0x${c.repeat(64)}`;
const H = 3600;
const T = 1_772_956_800; // a UTC midnight
const day = () => [
  { start: String(T), end: String(T + 8 * H), phase: 'OVERNIGHT', provenanceHash: hash('1') },
  { start: String(T + 8 * H), end: String(T + 14 * H), phase: 'PRE', provenanceHash: hash('2') },
  { start: String(T + 14 * H), end: String(T + 21 * H), phase: 'REGULAR', provenanceHash: hash('3') },
  { start: String(T + 21 * H), end: String(T + 24 * H), phase: 'POST', provenanceHash: hash('4') },
];
const opts = { coverageStart: T, coverageEnd: T + 24 * H, provenanceFor: (e) => hash(e.id === 'a' ? 'a' : 'b') };
const dataset = (intervals) => buildCalendarDataset({
  schemaVersion: 1, chainId: '4663', calendarRegistry: '0x1111111111111111111111111111111111111111', assetId: hash('9'), year: 2026,
  coverageStart: String(T), coverageEnd: String(T + 24 * H), capabilityMask: 0b11110,
  datasetProvenance: { timezone: 'America/New_York', timezoneDatabaseVersion: '2026a', sourceRightsEvidenceHash: hash('7'), sources: [{ sourceId: 'cal', version: '1', hash: hash('8') }] },
  intervals,
});

test('an event window inside one interval splits it into before, CLOSED and after', () => {
  const out = carveEventWindows(day(), [{ id: 'a', start: T + 16 * H, end: T + 18 * H }], opts);
  const regular = out.filter((i) => i.start >= String(T + 14 * H) && i.end <= String(T + 21 * H));
  assert.deepEqual(regular.map((i) => [i.start, i.end, i.phase]), [
    [String(T + 14 * H), String(T + 16 * H), 'REGULAR'],
    [String(T + 16 * H), String(T + 18 * H), 'CLOSED'],
    [String(T + 18 * H), String(T + 21 * H), 'REGULAR'],
  ]);
  assert.equal(regular[1].provenanceHash, hash('a'));
});

test('a window from the after-hours report to the next open spans intervals and becomes one CLOSED leaf', () => {
  const out = carveEventWindows(day(), [{ id: 'a', start: T + 22 * H, end: T + 24 * H }, { id: 'b', start: T + 6 * H, end: T + 10 * H }], opts);
  const closed = out.filter((i) => i.phase === 'CLOSED');
  assert.deepEqual(closed.map((i) => [i.start, i.end]), [[String(T + 6 * H), String(T + 10 * H)], [String(T + 22 * H), String(T + 24 * H)]]);
  assert.equal(out.filter((i) => i.provenanceHash === hash('b')).length, 1, 'a window that crosses two source intervals is one leaf');
});

test('the carved calendar is a valid partition with valid Merkle proofs, and the leaves name the window', () => {
  const carved = carveEventWindows(day(), [{ id: 'a', start: T + 16 * H, end: T + 18 * H }], opts);
  const ds = dataset(carved);
  assert.equal(validateCalendarPartition(ds.leaves, BigInt(T), BigInt(T + 24 * H)).valid, true);
  ds.leaves.forEach((leaf, i) => assert.equal(verifyMerkleProof(hashCalendarLeaf(leaf), ds.proofs[i], ds.merkleRoot), true));
  const event = ds.leaves.find((l) => l.provenanceHash === hash('a'));
  assert.equal(event.phase, 5);
  assert.equal(event.end - event.start, BigInt(2 * H));
});

test('every closed window is entered from an open phase and left into one, so close capture and the opening auction can run', () => {
  const carved = carveEventWindows(day(), [{ id: 'a', start: T + 16 * H, end: T + 18 * H }], opts);
  const i = carved.findIndex((x) => x.phase === 'CLOSED' && x.provenanceHash === hash('a'));
  assert.ok(['PRE', 'REGULAR', 'POST', 'OVERNIGHT'].includes(carved[i - 1].phase));
  assert.ok(['PRE', 'REGULAR', 'POST', 'OVERNIGHT'].includes(carved[i + 1].phase));
});

test('ambiguous or impossible events are refused, not guessed', () => {
  assert.throws(() => carveEventWindows(day(), [{ id: 'a', start: T + 16 * H, end: T + 18 * H }, { id: 'b', start: T + 17 * H, end: T + 19 * H }], opts), /overlap/);
  assert.throws(() => carveEventWindows(day(), [{ id: 'a', start: T + 18 * H, end: T + 16 * H }], opts), /end must be after start/);
  assert.throws(() => carveEventWindows(day(), [{ id: 'a', start: T - H, end: T + H }], opts), /outside the calendar coverage/);
  assert.throws(() => carveEventWindows(day(), [{ id: 'a', start: T + H, end: T + 2 * H }], { ...opts, provenanceFor: () => hash('0') }), /nonzero bytes32/);
  assert.throws(() => carveEventWindows(day(), [{ id: 'a', start: T + H, end: T + 2 * H }], { coverageStart: T, coverageEnd: T + 24 * H }), /provenanceFor/);
});

test('no events returns the source calendar unchanged', () => {
  assert.deepEqual(carveEventWindows(day(), [], opts), day());
});

test('describeEventWindows lists what each window replaced', () => {
  const [d] = describeEventWindows(day(), [{ id: 'a', start: T + 20 * H, end: T + 22 * H }]);
  assert.deepEqual(d.replaced.sort(), ['POST', 'REGULAR']);
});
