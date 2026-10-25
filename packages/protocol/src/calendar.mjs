import { concat, encodeAbiParameters, keccak256, toHex } from 'viem';

const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const BYTES32 = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const LEAF_DOMAIN = keccak256(toHex('BELL_CALENDAR_LEAF_V1'));
const LEAF_TYPES = [
  { name: 'domain', type: 'bytes32' },
  { name: 'chainId', type: 'uint256' },
  { name: 'calendarRegistry', type: 'address' },
  { name: 'assetId', type: 'bytes32' },
  { name: 'year', type: 'uint32' },
  { name: 'index', type: 'uint32' },
  { name: 'start', type: 'uint64' },
  { name: 'end', type: 'uint64' },
  { name: 'phase', type: 'uint8' },
  { name: 'provenanceHash', type: 'bytes32' },
];

function unsigned(value, max, name) {
  const parsed = typeof value === 'bigint' ? value : Number.isSafeInteger(value) ? BigInt(value) : -1n;
  if (parsed < 0n || parsed > max) throw new RangeError(`${name} is outside its unsigned integer domain`);
  return parsed;
}

function validateLeaf(leaf) {
  if (!leaf || !ADDRESS.test(leaf.calendarRegistry ?? '') || !BYTES32.test(leaf.assetId ?? '')
    || !BYTES32.test(leaf.provenanceHash ?? '')
    || leaf.calendarRegistry.toLowerCase() === ZERO_ADDRESS
    || leaf.assetId.toLowerCase() === ZERO_BYTES32
    || leaf.provenanceHash.toLowerCase() === ZERO_BYTES32) {
    throw new TypeError('calendar leaf has an invalid or zero identity field');
  }
  const chainId = unsigned(leaf.chainId, UINT256_MAX, 'chainId');
  const year = unsigned(leaf.year, UINT32_MAX, 'year');
  const index = unsigned(leaf.index, UINT32_MAX, 'index');
  const start = unsigned(leaf.start, UINT64_MAX, 'start');
  const end = unsigned(leaf.end, UINT64_MAX, 'end');
  const phase = Number(leaf.phase);
  if (end <= start) throw new RangeError('calendar interval must have end > start');
  if (!Number.isInteger(phase) || phase < 1 || phase > 5) throw new RangeError('calendar phase must be a defined MarketPhase');
  return { chainId, year, index, start, end, phase };
}

export function hashCalendarLeaf(leaf) {
  const values = validateLeaf(leaf);
  const encoded = encodeAbiParameters(LEAF_TYPES, [
    LEAF_DOMAIN,
    values.chainId,
    leaf.calendarRegistry,
    leaf.assetId,
    values.year,
    values.index,
    values.start,
    values.end,
    values.phase,
    leaf.provenanceHash,
  ]);
  return keccak256(keccak256(encoded));
}

export function hashSortedPair(left, right) {
  if (!BYTES32.test(left) || !BYTES32.test(right)) throw new TypeError('Merkle nodes must be bytes32');
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return keccak256(a <= b ? concat([a, b]) : concat([b, a]));
}

export function hashCalendarDataset(canonicalJson) {
  if (typeof canonicalJson !== 'string') throw new TypeError('canonical calendar dataset must be a string');
  return keccak256(toHex(canonicalJson));
}

export function verifyMerkleProof(leafHash, proof, root) {
  if (!BYTES32.test(leafHash) || !BYTES32.test(root) || !Array.isArray(proof) || proof.length > 32
    || proof.some((node) => !BYTES32.test(node))) return false;
  let computed = leafHash.toLowerCase();
  for (const sibling of proof) computed = hashSortedPair(computed, sibling);
  return computed === root.toLowerCase();
}

export function validateCalendarPartition(leaves, coverageStart, coverageEnd) {
  const reasons = [];
  let start;
  let end;
  try {
    start = unsigned(coverageStart, UINT64_MAX, 'coverageStart');
    end = unsigned(coverageEnd, UINT64_MAX, 'coverageEnd');
  } catch {
    return Object.freeze({ valid: false, reasons: Object.freeze(['INVALID_COVERAGE']) });
  }
  if (!Array.isArray(leaves) || leaves.length === 0 || end <= start) {
    return Object.freeze({ valid: false, reasons: Object.freeze(['EMPTY_OR_INVALID_COVERAGE']) });
  }
  let previousEnd = start;
  let firstStart = null;
  let identity = null;
  for (let position = 0; position < leaves.length; position += 1) {
    try {
      const fields = validateLeaf(leaves[position]);
      const currentIdentity = [fields.chainId.toString(), leaves[position].calendarRegistry.toLowerCase(),
        leaves[position].assetId.toLowerCase(), fields.year.toString()].join(':');
      if (identity === null) identity = currentIdentity;
      else if (identity !== currentIdentity) reasons.push('ROOT_IDENTITY_MISMATCH');
      if (position === 0) firstStart = fields.start;
      if (fields.index !== BigInt(position)) reasons.push('INDEX_SEQUENCE');
      if (fields.start !== previousEnd) reasons.push(fields.start < previousEnd ? 'OVERLAP' : 'GAP');
      previousEnd = fields.end;
    } catch {
      reasons.push('INVALID_LEAF');
    }
  }
  if (firstStart !== start) reasons.push('COVERAGE_START_MISMATCH');
  if (previousEnd !== end) reasons.push('COVERAGE_END_MISMATCH');
  return Object.freeze({ valid: reasons.length === 0, reasons: Object.freeze([...new Set(reasons)]) });
}
