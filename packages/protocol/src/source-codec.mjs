import { decodeAbiParameters, encodeAbiParameters } from 'viem';

const ZERO32 = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const BYTES32 = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
export const SOURCE_WIRE_COMPONENTS = Object.freeze([
  { name: 'kind', type: 'uint8' },
  { name: 'phaseScope', type: 'uint8' },
  { name: 'endpoint', type: 'address' },
  { name: 'feedId', type: 'bytes32' },
  { name: 'schema', type: 'uint16' },
  { name: 'decimals', type: 'uint8' },
  { name: 'priceBasis', type: 'uint8' },
  { name: 'heartbeatSec', type: 'uint32' },
  { name: 'expectedCodeHash', type: 'bytes32' },
  { name: 'expectedImplementation', type: 'address' },
  { name: 'canonicalTokenId', type: 'bytes32' },
]);
const ABI = [{ type: 'tuple[]', components: SOURCE_WIRE_COMPONENTS }];

function validateWires(wires) {
  if (!Array.isArray(wires) || wires.length === 0 || wires.length > 5) {
    throw new RangeError('sourceConfig must contain one through five SourceWire entries');
  }
  const identities = new Set();
  for (const wire of wires) {
    if (!wire || typeof wire !== 'object') throw new TypeError('SourceWire must be an object');
    const numericFields = [wire.kind, wire.phaseScope, wire.schema, wire.decimals, wire.priceBasis, wire.heartbeatSec];
    if (numericFields.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new RangeError('SourceWire numeric field is invalid');
    if (wire.kind < 1 || wire.kind > 4 || wire.phaseScope > 4 || wire.schema > 65535
      || wire.decimals > 18 || wire.priceBasis < 1 || wire.priceBasis > 4 || wire.heartbeatSec > 0xffffffff) {
      throw new RangeError('SourceWire field is outside its ABI domain');
    }
    if (!ADDRESS.test(wire.endpoint ?? '') || wire.endpoint.toLowerCase() === ZERO_ADDRESS
      || !ADDRESS.test(wire.expectedImplementation ?? '') || wire.expectedImplementation.toLowerCase() === ZERO_ADDRESS
      || !BYTES32.test(wire.feedId ?? '') || !BYTES32.test(wire.expectedCodeHash ?? '')
      || wire.expectedCodeHash.toLowerCase() === ZERO32 || !BYTES32.test(wire.canonicalTokenId ?? '')
      || wire.canonicalTokenId.toLowerCase() === ZERO32) {
      throw new TypeError('SourceWire requires nonzero addresses, code identity, feed ID, and canonicalTokenId');
    }

    if ((wire.kind === 1 && (wire.phaseScope !== 0 || wire.schema !== 0 || wire.feedId.toLowerCase() !== ZERO32 || wire.priceBasis !== 2))
      || (wire.kind === 2 && (wire.phaseScope !== 0 || wire.schema !== 0 || wire.feedId.toLowerCase() !== ZERO32 || wire.priceBasis !== 3))
      || (wire.kind === 3 && (wire.phaseScope < 1 || wire.phaseScope > 3 || (wire.schema !== 11 && wire.schema !== 12) || wire.feedId.toLowerCase() === ZERO32 || wire.priceBasis !== 1))
      || (wire.kind === 4 && (wire.phaseScope !== 4 || wire.schema === 0 || wire.feedId.toLowerCase() === ZERO32 || wire.priceBasis !== 4))) {
      throw new Error('SourceWire kind, phase scope, schema, feed ID, and price basis are inconsistent');
    }
    const identity = `${wire.kind}:${wire.phaseScope}`;
    if (identities.has(identity)) throw new Error('duplicate SourceWire kind/phase scope');
    identities.add(identity);
  }
}

function normalizeDecoded(wire) {
  const values = Array.isArray(wire)
    ? wire
    : SOURCE_WIRE_COMPONENTS.map(({ name }) => wire[name]);
  return {
    kind: Number(values[0]),
    phaseScope: Number(values[1]),
    endpoint: values[2],
    feedId: values[3],
    schema: Number(values[4]),
    decimals: Number(values[5]),
    priceBasis: Number(values[6]),
    heartbeatSec: Number(values[7]),
    expectedCodeHash: values[8],
    expectedImplementation: values[9],
    canonicalTokenId: values[10],
  };
}

export function encodeSourceWires(wires) {
  validateWires(wires);
  return encodeAbiParameters(ABI, [wires]);
}

export function decodeSourceWires(encoded) {
  if (typeof encoded !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(encoded)) {
    throw new TypeError('sourceConfig must be even-length hex bytes');
  }
  let decoded;
  try {
    decoded = decodeAbiParameters(ABI, encoded)[0].map(normalizeDecoded);
  } catch {
    throw new Error('sourceConfig ABI decoding failed');
  }
  validateWires(decoded);
  if (encodeSourceWires(decoded).toLowerCase() !== encoded.toLowerCase()) {
    throw new Error('sourceConfig is non-canonical or contains trailing ABI data');
  }
  return decoded;
}
