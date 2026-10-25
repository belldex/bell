import test from 'node:test';
import assert from 'node:assert/strict';
import { hashCalendarLeaf, verifyMerkleProof, validateCalendarPartition } from '../../packages/protocol/src/calendar.mjs';
import { buildCalendarDataset } from './calendar-builder.mjs';

const hash = (character) => `0x${character.repeat(64)}`;
const base = () => ({
  schemaVersion: 1,
  chainId: '4663',
  calendarRegistry: '0x1111111111111111111111111111111111111111',
  assetId: hash('a'),
  year: 2026,
  coverageStart: '1772956800',
  coverageEnd: '1773043200',
  capabilityMask: 0b0100,
  datasetProvenance: {
    timezone: 'America/New_York',
    timezoneDatabaseVersion: '2026a',
    sourceRightsEvidenceHash: hash('b'),
    sources: [{ sourceId: 'venue-calendar', version: '2026-03-08', hash: hash('c') }],
  },
  intervals: [
    // Explicit UTC values span the DST transition. The builder must not calculate them.
    { start: '1772956800', end: '1772971200', phase: 'REGULAR', provenanceHash: hash('d') },
    { start: '1772971200', end: '1773043200', phase: 'CLOSED', provenanceHash: hash('e') },
  ],
});

test('builds an exact explicit-UTC DST partition with source and tzdb provenance', () => {
  const result = buildCalendarDataset(base());
  assert.deepEqual(result.leaves.map(({ start, end, phase }) => [start, end, phase]), [
    [1772956800n, 1772971200n, 2], [1772971200n, 1773043200n, 5],
  ]);
  assert.equal(result.timezone, 'America/New_York');
  assert.equal(result.timezoneDatabaseVersion, '2026a');
  assert.equal(validateCalendarPartition(result.leaves, 1772956800n, 1773043200n).valid, true);
});

test('preserves explicit holiday and early-close UTC source intervals and provenance', () => {
  const input = base();
  input.intervals = [
    { start: '1772956800', end: '1772960400', phase: 'CLOSED', provenanceHash: hash('1') },
    { start: '1772960400', end: '1772964000', phase: 'REGULAR', provenanceHash: hash('2') },
    { start: '1772964000', end: '1773043200', phase: 'CLOSED', provenanceHash: hash('3') },
  ];
  const result = buildCalendarDataset(input);
  assert.equal(result.leaves[1].provenanceHash, hash('2'));
  assert.equal(result.leaves[2].phase, 5);
});

test('maps unsupported capability phases to CLOSED with transformed provenance', () => {
  const input = base();
  input.capabilityMask = 0b0100; // REGULAR is bit 2 under `1 << MarketPhase`.
  input.intervals[0].phase = 'PRE';
  const result = buildCalendarDataset(input);
  assert.equal(result.leaves[0].phase, 5);
  assert.notEqual(result.leaves[0].provenanceHash, hash('d'));
  assert.equal(result.normalizedIntervals[0].transformedFromPhase, 'PRE');
});

test('uses normative MarketPhase bit positions in capability masks', () => {
  const input = base();
  input.capabilityMask = 1 << 2; // REGULAR is bit 2: `1 << MarketPhase.REGULAR`.
  const result = buildCalendarDataset(input);
  assert.equal(result.normalizedIntervals[0].phase, 'REGULAR');
  assert.equal(result.leaves[0].phase, 2);

  input.capabilityMask = 1 << 1; // PRE only; a REGULAR interval is unsupported.
  const unsupported = buildCalendarDataset(input);
  assert.equal(unsupported.normalizedIntervals[0].phase, 'CLOSED');
  assert.equal(unsupported.leaves[0].phase, 5);
});

test('rejects missing coverage, overlaps, and conflicting source intervals without defaulting a phase', () => {
  for (const intervals of [
    [{ start: '1772956800', end: '1772971200', phase: 'REGULAR', provenanceHash: hash('d') }],
    [{ start: '1772956800', end: '1772971201', phase: 'REGULAR', provenanceHash: hash('d') }, { start: '1772971200', end: '1773043200', phase: 'CLOSED', provenanceHash: hash('e') }],
    [{ start: '1772956800', end: '1773043200', phase: 'REGULAR', provenanceHash: hash('d'), sourceId: 'a' }, { start: '1772956800', end: '1773043200', phase: 'CLOSED', provenanceHash: hash('e'), sourceId: 'b' }],
  ]) {
    const input = base();
    input.intervals = intervals;
    assert.throws(() => buildCalendarDataset(input), /coverage|gap|overlap|conflict/i);
  }
});

test('rejects missing or zero rights evidence and invalid capability masks', () => {
  for (const change of [
    { sourceRightsEvidenceHash: undefined }, { sourceRightsEvidenceHash: hash('0') },
  ]) {
    const input = base();
    Object.assign(input.datasetProvenance, change);
    assert.throws(() => buildCalendarDataset(input), /rights|evidence/i);
  }
  const input = base();
  input.capabilityMask = 0b10_0000;
  assert.throws(() => buildCalendarDataset(input), /capability/i);
  input.capabilityMask = 0b0001;
  assert.throws(() => buildCalendarDataset(input), /capability/i);
  input.capabilityMask = 0x1_0000_0004;
  assert.throws(() => buildCalendarDataset(input), /capability/i);
});

test('produces compatible sorted-pair proofs for odd leaf counts', () => {
  const input = base();
  input.intervals = [
    { start: '1772956800', end: '1772960400', phase: 'CLOSED', provenanceHash: hash('1') },
    { start: '1772960400', end: '1772964000', phase: 'REGULAR', provenanceHash: hash('2') },
    { start: '1772964000', end: '1773043200', phase: 'CLOSED', provenanceHash: hash('3') },
  ];
  const result = buildCalendarDataset(input);
  for (let index = 0; index < result.leaves.length; index += 1) {
    assert.equal(verifyMerkleProof(hashCalendarLeaf(result.leaves[index]), result.proofs[index], result.merkleRoot), true);
  }
});

test('is deterministic across equivalent input object key order', () => {
  const first = buildCalendarDataset(base());
  const input = base();
  input.intervals.reverse();
  const second = buildCalendarDataset(input);
  assert.equal(second.datasetHash, first.datasetHash);
  assert.equal(second.merkleRoot, first.merkleRoot);
  assert.deepEqual(second.leaves, first.leaves);
});
