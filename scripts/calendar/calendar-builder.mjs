import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hashCalendarDataset, hashCalendarLeaf, hashSortedPair, validateCalendarPartition, verifyMerkleProof } from '../../packages/protocol/src/calendar.mjs';

const BYTES32 = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const PHASES = Object.freeze({ PRE: 1, REGULAR: 2, POST: 3, OVERNIGHT: 4, CLOSED: 5 });
const PHASE_CAPABILITY = Object.freeze({ PRE: 1 << 1, REGULAR: 1 << 2, POST: 1 << 3, OVERNIGHT: 1 << 4 });

function stableJson(value) {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function uint(value, max, name) {
  const parsed = typeof value === 'bigint' ? value : typeof value === 'string' && /^\d+$/.test(value)
    ? BigInt(value) : Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : -1n;
  if (parsed < 0n || parsed > max) throw new RangeError(`${name} is outside its unsigned integer domain`);
  return parsed;
}

function nonzeroHash(value, name) {
  if (typeof value !== 'string' || !BYTES32.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw new TypeError(`${name} must be a nonzero bytes32 hash`);
  }
  return value.toLowerCase();
}

function phaseName(value) {
  if (typeof value === 'string' && Object.hasOwn(PHASES, value)) return value;
  if (Number.isInteger(value)) return Object.entries(PHASES).find(([, code]) => code === value)?.[0];
  throw new RangeError('interval phase must be PRE, REGULAR, POST, OVERNIGHT, or CLOSED');
}

function assertYearRange(year, start, end) {
  const yearStart = BigInt(Date.UTC(Number(year), 0, 1) / 1000);
  const nextYearStart = BigInt(Date.UTC(Number(year) + 1, 0, 1) / 1000);
  if (start < yearStart || end > nextYearStart) throw new RangeError('coverage and intervals must remain within the declared UTC year');
}

function transformedProvenanceHash(originalProvenanceHash, originalPhase, capabilityMask) {
  return hashCalendarDataset(stableJson({
    domain: 'BELL_CALENDAR_UNSUPPORTED_CAPABILITY_CLOSED_V1',
    originalPhase,
    originalProvenanceHash,
    capabilityMask: capabilityMask.toString(),
  }));
}

function buildMerkleProofs(leafHashes) {
  const proofs = leafHashes.map(() => []);
  let level = leafHashes.map((hash, index) => ({ hash, members: [index] }));
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      if (!right) {
        next.push(left); // Carry unpaired nodes unchanged; no synthetic self-sibling.
        continue;
      }
      for (const member of left.members) proofs[member].push(right.hash);
      for (const member of right.members) proofs[member].push(left.hash);
      next.push({ hash: hashSortedPair(left.hash, right.hash), members: [...left.members, ...right.members] });
    }
    level = next;
  }
  return { merkleRoot: level[0].hash, proofs: proofs.map((proof) => Object.freeze(proof)) };
}

/**
 * Offline input schema (schemaVersion: 1):
 * {
 *   chainId: decimal string | safe integer, calendarRegistry: 0x address, assetId: bytes32,
 *   year: uint32, coverageStart/coverageEnd: UTC Unix-second decimal strings,
  *   capabilityMask: uint8 with only bits 1–4 (`1 << MarketPhase`),
 *   datasetProvenance: { timezone, timezoneDatabaseVersion, sourceRightsEvidenceHash: bytes32,
 *     sources: [{ sourceId, version, hash: bytes32 }] },
 *   intervals: [{ start, end, phase: PRE|REGULAR|POST|OVERNIGHT|CLOSED, provenanceHash: bytes32 }]
 * }
 * All interval timestamps are already UTC. This builder does not fetch schedules, infer holidays,
 * convert local time, or fill missing coverage. Run: node scripts/calendar/calendar-builder.mjs input.json output.json
 */
export function buildCalendarDataset(input) {
  if (!input || typeof input !== 'object' || input.schemaVersion !== 1) throw new TypeError('schemaVersion 1 input is required');
  const chainId = uint(input.chainId, UINT256_MAX, 'chainId');
  if (chainId === 0n) throw new RangeError('chainId must be nonzero');
  if (typeof input.calendarRegistry !== 'string' || !ADDRESS.test(input.calendarRegistry) || input.calendarRegistry.toLowerCase() === ZERO_ADDRESS) throw new TypeError('calendarRegistry must be a nonzero address');
  const calendarRegistry = input.calendarRegistry.toLowerCase();
  const assetId = nonzeroHash(input.assetId, 'assetId');
  const year = uint(input.year, UINT32_MAX, 'year');
  const coverageStart = uint(input.coverageStart, UINT64_MAX, 'coverageStart');
  const coverageEnd = uint(input.coverageEnd, UINT64_MAX, 'coverageEnd');
  if (coverageEnd <= coverageStart) throw new RangeError('coverageEnd must be after coverageStart');
  assertYearRange(year, coverageStart, coverageEnd);
  if (!Number.isSafeInteger(input.capabilityMask) || input.capabilityMask < 0 || input.capabilityMask > 0xff
    || (input.capabilityMask & ~0b1_1110) !== 0) throw new RangeError('capabilityMask may contain only uint8 bits 1-4');
  const capabilityMask = BigInt(input.capabilityMask);
  const provenance = input.datasetProvenance;
  if (!provenance || typeof provenance.timezone !== 'string' || provenance.timezone.length === 0 || typeof provenance.timezoneDatabaseVersion !== 'string' || provenance.timezoneDatabaseVersion.length === 0) throw new TypeError('dataset timezone and timezone database version are required');
  const sourceRightsEvidenceHash = nonzeroHash(provenance.sourceRightsEvidenceHash, 'source rights evidence');
  if (!Array.isArray(provenance.sources) || provenance.sources.length === 0) throw new TypeError('at least one dataset source is required');
  const sources = provenance.sources.map((source) => {
    if (!source || typeof source.sourceId !== 'string' || !source.sourceId || typeof source.version !== 'string' || !source.version) throw new TypeError('dataset source id and version are required');
    return Object.freeze({ sourceId: source.sourceId, version: source.version, hash: nonzeroHash(source.hash, 'dataset source hash') });
  }).sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  if (new Set(sources.map(stableJson)).size !== sources.length) throw new Error('duplicate dataset source provenance');
  if (!Array.isArray(input.intervals) || input.intervals.length === 0 || input.intervals.length > Number(UINT32_MAX)) throw new RangeError('leaf count must be between 1 and uint32 maximum');
  const intervals = input.intervals.map((interval) => {
    if (!interval || typeof interval !== 'object') throw new TypeError('interval must be an object');
    const start = uint(interval.start, UINT64_MAX, 'interval start');
    const end = uint(interval.end, UINT64_MAX, 'interval end');
    if (end <= start) throw new RangeError('interval end must be after start');
    assertYearRange(year, start, end);
    const originalPhase = phaseName(interval.phase);
    const originalProvenanceHash = nonzeroHash(interval.provenanceHash, 'interval provenance');
    const unsupported = originalPhase !== 'CLOSED' && (capabilityMask & BigInt(PHASE_CAPABILITY[originalPhase])) === 0n;
    return { start, end, originalPhase, originalProvenanceHash, phase: unsupported ? 'CLOSED' : originalPhase,
      provenanceHash: unsupported ? transformedProvenanceHash(originalProvenanceHash, originalPhase, capabilityMask) : originalProvenanceHash,
      transformedFromPhase: unsupported ? originalPhase : undefined };
  }).sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : stableJson(a).localeCompare(stableJson(b)));
  let previousEnd = coverageStart;
  for (const interval of intervals) {
    if (interval.start !== previousEnd) throw new Error(interval.start < previousEnd ? 'conflicting or overlapping source intervals' : 'coverage gap in source intervals');
    previousEnd = interval.end;
  }
  if (previousEnd !== coverageEnd) throw new Error('coverage gap at coverage end');
  const normalizedIntervals = intervals.map(({ start, end, phase, provenanceHash, transformedFromPhase }) => Object.freeze({
    start, end, phase, provenanceHash, ...(transformedFromPhase ? { transformedFromPhase } : {}),
  }));
  const datasetHash = hashCalendarDataset(stableJson({
    domain: 'BELL_CALENDAR_DATASET_V1', chainId: chainId.toString(), calendarRegistry, assetId, year: year.toString(),
    coverageStart: coverageStart.toString(), coverageEnd: coverageEnd.toString(), capabilityMask: capabilityMask.toString(),
    datasetProvenance: { timezone: provenance.timezone, timezoneDatabaseVersion: provenance.timezoneDatabaseVersion, sourceRightsEvidenceHash, sources },
    intervals: normalizedIntervals.map((interval) => ({ ...interval, start: interval.start.toString(), end: interval.end.toString() })),
  }));
  const leaves = normalizedIntervals.map((interval, index) => Object.freeze({ chainId, calendarRegistry, assetId, year, index, start: interval.start, end: interval.end, phase: PHASES[interval.phase], provenanceHash: interval.provenanceHash }));
  const partition = validateCalendarPartition(leaves, coverageStart, coverageEnd);
  if (!partition.valid) throw new Error(`invalid normalized calendar partition: ${partition.reasons.join(',')}`);
  const leafHashes = leaves.map(hashCalendarLeaf);
  const { merkleRoot, proofs } = buildMerkleProofs(leafHashes);
  if (proofs.some((proof, index) => !verifyMerkleProof(leafHashes[index], proof, merkleRoot))) throw new Error('internal Merkle proof verification failed');
  return Object.freeze({ schemaVersion: 1, chainId, calendarRegistry, assetId, year, coverageStart, coverageEnd, capabilityMask, timezone: provenance.timezone, timezoneDatabaseVersion: provenance.timezoneDatabaseVersion, sourceRightsEvidenceHash, sources: Object.freeze(sources), datasetHash, leafCount: leaves.length, normalizedIntervals: Object.freeze(normalizedIntervals), leaves: Object.freeze(leaves), leafHashes: Object.freeze(leafHashes), merkleRoot, proofs: Object.freeze(proofs) });
}

function jsonValue(_key, value) { return typeof value === 'bigint' ? value.toString() : value; }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath || process.argv.length !== 4) throw new Error('Usage: node scripts/calendar/calendar-builder.mjs input.json output.json');
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const result = buildCalendarDataset(input); // Validate fully before opening the output for writing.
  await writeFile(outputPath, `${JSON.stringify(result, jsonValue, 2)}\n`, 'utf8');
}
