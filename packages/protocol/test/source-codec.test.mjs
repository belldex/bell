import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSourceWires, encodeSourceWires } from '../src/source-codec.mjs';
import vector from '../../test-vectors/runtime-compat.json' with { type: 'json' };

const wire = (overrides = {}) => ({
  kind: 3,
  phaseScope: 1,
  endpoint: '0x1111111111111111111111111111111111111111',
  feedId: `0x${'a'.repeat(64)}`,
  schema: 11,
  decimals: 8,
  priceBasis: 1,
  heartbeatSec: 600,
  expectedCodeHash: `0x${'b'.repeat(64)}`,
  expectedImplementation: '0x2222222222222222222222222222222222222222',
  canonicalTokenId: `0x${'c'.repeat(64)}`,
  ...overrides,
});

test('encodes and decodes the normative SourceWire tuple array canonically', () => {
  const wires = [wire(), wire({ phaseScope: 2, feedId: `0x${'d'.repeat(64)}` })];
  const encoded = encodeSourceWires(wires);
  assert.match(encoded, /^0x[0-9a-f]+$/i);
  assert.deepEqual(decodeSourceWires(encoded), wires);
});

test('matches the shared ABI SourceWire encoding vector', () => {
  assert.equal(encodeSourceWires([vector.sourceWire]), vector.sourceWireEncoded);
});

test('rejects duplicate source scopes, kind/schema mismatches, invalid bytes, and oversized arrays', () => {
  assert.throws(() => encodeSourceWires([wire(), wire()]), /duplicate/i);
  assert.throws(() => encodeSourceWires([wire({ schema: 10 })]), /schema/i);
  assert.throws(() => encodeSourceWires([wire({ feedId: `0x${'0'.repeat(64)}` })]), /feed/i);
  assert.throws(() => encodeSourceWires(Array.from({ length: 6 }, (_, index) => wire({ phaseScope: index % 4 + 1, feedId: `0x${(index + 1).toString(16).padStart(64, '0')}` }))), /five/i);
});

test('rejects non-canonical or trailing ABI bytes on decode', () => {
  const encoded = encodeSourceWires([wire()]);
  assert.throws(() => decodeSourceWires(`${encoded}00`), /canonical|trailing/i);
  assert.throws(() => decodeSourceWires('0x1234'), /ABI|decode|canonical/i);
});
