import test from 'node:test';
import assert from 'node:assert/strict';
import {
  route, normalizePathPrefix, envelope, errorBody, ERROR_SEMANTICS, validateChainId, validateBoundedLimit,
  validateHash, validateAddress, validateAmount, validateJsonBody, validateQuoteExpiry, validateDeadline, ValidationError,
} from '../src/api-schema.mjs';

const H = (n) => '0x' + n.toString(16).padStart(64, '0');

test('deployment prefix is separated from the logical path', () => {
  assert.equal(normalizePathPrefix('/functions/v1/bell-api/pools'), '/pools');
  assert.equal(normalizePathPrefix('/pools'), '/pools');
  assert.equal(route('GET', '/functions/v1/bell-api/assets').endpoint.path, '/assets');
});

test('routes match exactly, with path params, and reject unknown paths', () => {
  assert.equal(route('GET', '/pools').endpoint.path, '/pools');
  const policy = route('GET', '/pools/abc/policy');
  assert.equal(policy.endpoint.path, '/pools/{id}/policy');
  assert.deepEqual(policy.params, { id: 'abc' });
  assert.equal(route('GET', '/pools/abc/unknown'), null);
  assert.equal(route('POST', '/pools'), null);
  assert.equal(route('GET', '/quote'), null);
});

test('malformed inputs are rejected before any RPC work', () => {
  assert.throws(() => validateChainId(0), ValidationError);
  assert.throws(() => validateChainId('99999999999'), ValidationError);
  assert.throws(() => validateBoundedLimit('0'), ValidationError);
  assert.throws(() => validateBoundedLimit(1000), ValidationError);
  assert.throws(() => validateHash('0x1234', 'hash'), ValidationError);
  assert.throws(() => validateAddress('nope', 'addr'), ValidationError);
  assert.throws(() => validateAmount(123n, 'amountIn'), /decimal string/);
  assert.throws(() => validateAmount('1.5e30', 'amountIn'), ValidationError);
  assert.throws(() => validateJsonBody([1, 2]), /JSON object/);
  assert.equal(validateChainId('4663'), 4663);
  assert.equal(validateAmount('450889000000000000000'), '450889000000000000000');
});

test('amounts stay decimal strings; hashes and addresses normalize to lowercase', () => {
  assert.equal(validateHash(H(1).toUpperCase(), 'h'), H(1));
  assert.equal(validateAddress('0x' + 'AB'.repeat(20), 'a'), '0x' + 'ab'.repeat(20));
});

test('envelope carries real provenance and refuses OK status without it', () => {
  const ok = envelope({ chainId: 4663, observedBlockNumber: 100, observedBlockHash: H(1), observedAt: 1792900000000 });
  assert.equal(ok.apiVersion, 'v1');
  assert.equal(ok.observedBlockNumber, 100);
  assert.equal(ok.observedBlockHash, H(1));
  assert.throws(() => envelope({ chainId: 4663 }), /provenance/);
  assert.throws(() => envelope({ chainId: 4663, observedBlockNumber: 100, observedBlockHash: '0xdead' }), /32-byte/);
});

test('envelope never fabricates block evidence when a dependency is unavailable', () => {
  const down = envelope({ chainId: 4663, observedAt: null, status: 'UNAVAILABLE' });
  assert.equal(down.observedBlockNumber, null);
  assert.equal(down.observedBlockHash, null);
  assert.equal(down.status, 'UNAVAILABLE');
});

test('error bodies match the plan §8.4 semantics table', () => {
  assert.equal(ERROR_SEMANTICS.VALIDATION.http, 400);
  assert.equal(ERROR_SEMANTICS.NOT_FOUND.http, 404);
  assert.equal(ERROR_SEMANTICS.CONFLICT.http, 409);
  assert.equal(ERROR_SEMANTICS.RATE_LIMITED.http, 429);
  assert.equal(ERROR_SEMANTICS.UNAVAILABLE.http, 503);
  assert.equal(ERROR_SEMANTICS.INTERNAL.http, 500);
  const limited = errorBody('RATE_LIMITED', { retryAfterSeconds: 90 });
  assert.equal(limited.error.retryAfter, 90);
  const validation = errorBody('VALIDATION', { field: 'chainId' });
  assert.equal(validation.error.retryAfter, null);
  assert.equal(validation.error.field, 'chainId');
  assert.throws(() => errorBody('NOPE'), /unknown error kind/);
});

test('quote expiry and deadline bounds are representable in the contract', () => {
  // 30s quote expiry / 120s deadline are normative maxima from the brief.
  assert.equal(validateQuoteExpiry(30), 30);
  assert.equal(validateDeadline(120), 120);
  assert.throws(() => validateQuoteExpiry(31), /1\.\.30/);
  assert.throws(() => validateDeadline(121), /1\.\.120/);
  const ok = envelope({ chainId: 1, observedBlockNumber: 1, observedBlockHash: H(2), extra: { quoteExpirySeconds: 30, deadlineSeconds: 120 } });
  assert.equal(ok.quoteExpirySeconds, 30);
});
