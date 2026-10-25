import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUnits, parseUnits } from '../src/amounts.mjs';

test('parses and formats amounts above JavaScript safe integer range exactly', () => {
  const value = '9007199254740993.000001';
  assert.equal(parseUnits(value, 6), 9007199254740993000001n);
  assert.equal(formatUnits(9007199254740993000001n, 6), value);
});

test('rejects exponent notation, excess precision, negatives, and invalid decimals', () => {
  for (const value of ['1e6', '-1', '1.0000001', '01.2', '']) {
    assert.throws(() => parseUnits(value, 6));
  }
  assert.throws(() => parseUnits('1', 19));
});

test('rejects raw quantities outside uint128', () => {
  assert.throws(() => parseUnits('340282366920938463463374607431768211456', 0), /uint128/i);
});
