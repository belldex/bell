import test from 'node:test';
import assert from 'node:assert/strict';
import { bellFee } from '../src/fee-policy.mjs';
import { parseUnits } from '../src/amounts.mjs';
import vector from '../../test-vectors/runtime-compat.json' with { type: 'json' };

test('Node matches the shared runtime compatibility vector', () => {
  assert.equal(bellFee(vector.fee.baseSessionFee, vector.fee.bellElapsedSeconds), vector.fee.expectedFeeUnits);
  assert.equal(parseUnits(vector.amount.display, vector.amount.decimals).toString(), vector.amount.expectedRaw);
});
