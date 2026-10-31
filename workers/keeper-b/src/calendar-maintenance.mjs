import { keccak256, stringToHex } from 'viem';
import { hashCalendarLeaf, verifyMerkleProof } from '@bell/protocol/calendar';
import { buildCalendarDataset } from '../../../scripts/calendar/calendar-builder.mjs';
import { buildEtMarketIntervals } from '../../../scripts/calendar/et-market-calendar.mjs';

const ZERO32 = `0x${'0'.repeat(64)}`;
const TABLE_PROVENANCE = keccak256(stringToHex('BELL_MAINNET_US_EASTERN_SESSIONS_V1'));

/** Rebuild the already-published calendar commitment and return proofs for its live leaf. */
export function buildCalendarActivation({ config, chainId, calendarRegistry, assetId, nowSeconds }) {
  const coverageStart = Number(config.coverageStart);
  const coverageEnd = Number(config.coverageEnd);
  const year = Number(config.year);
  const capabilityMask = Number(config.capabilityMask);
  const dataset = buildCalendarDataset({
    schemaVersion: 1,
    chainId: String(chainId), calendarRegistry, assetId, year,
    coverageStart: String(coverageStart), coverageEnd: String(coverageEnd), capabilityMask,
    datasetProvenance: {
      timezone: 'America/New_York', timezoneDatabaseVersion: '2026a',
      sourceRightsEvidenceHash: keccak256(stringToHex('BELL_SELF_DECLARED_SESSION_TABLE')),
      sources: [{ sourceId: 'bell-session-table', version: 'v1', hash: TABLE_PROVENANCE }],
    },
    intervals: buildEtMarketIntervals(coverageStart, coverageEnd).map((interval) => ({
      start: String(interval.start), end: String(interval.end), phase: interval.phase, provenanceHash: TABLE_PROVENANCE,
    })),
  });
  if (dataset.merkleRoot.toLowerCase() !== config.root.toLowerCase()) throw new Error('rebuilt calendar does not match the published root');
  const activeIndex = dataset.leaves.findIndex((leaf) => Number(leaf.start) <= nowSeconds && nowSeconds < Number(leaf.end));
  if (activeIndex < 0) throw new Error('published calendar has no interval for the current time');
  const current = dataset.leaves[activeIndex];
  const previous = dataset.leaves[activeIndex - 1] ?? null;
  const next = dataset.leaves[activeIndex + 1] ?? null;
  if (!verifyMerkleProof(hashCalendarLeaf(current), dataset.proofs[activeIndex], dataset.merkleRoot)) {
    throw new Error('current interval proof failed local verification');
  }
  const toSolidity = (leaf) => leaf ? ({
    assetId: leaf.assetId, year: Number(leaf.year), index: Number(leaf.index),
    start: BigInt(leaf.start), end: BigInt(leaf.end), phase: Number(leaf.phase), provenanceHash: leaf.provenanceHash,
  }) : ({ assetId: ZERO32, year: 0, index: 0, start: 0n, end: 0n, phase: 0, provenanceHash: ZERO32 });
  return {
    phase: Number(current.phase),
    current: toSolidity(current), previous: toSolidity(previous), next: toSolidity(next),
    proofs: [dataset.proofs[activeIndex], previous ? dataset.proofs[activeIndex - 1] : [], next ? dataset.proofs[activeIndex + 1] : []],
  };
}
