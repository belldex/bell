// BELL public API contract (plan M08-01, brief §20.K, G01/G02/G37).
// Logical paths are deployment-agnostic (a Supabase deployment adds its own
// prefix). Malformed input is rejected here, before any RPC or signing work.
// Envelopes never fabricate block evidence: an unavailable dependency yields
// explicit null provenance, never a stale value labelled live.
export const API_VERSION = 'v1';

export const ENDPOINTS = Object.freeze([
  { method: 'GET', path: '/assets' },
  { method: 'GET', path: '/pools' },
  { method: 'GET', path: '/pools/{id}/policy' },
  { method: 'POST', path: '/quote' },
  { method: 'POST', path: '/create-preview' },
  { method: 'GET', path: '/tx/{hash}' },
]);

const HEX32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL_STRING = /^-?(?:0|[1-9][0-9]*)$/;
const MAX_CHAIN_ID = 4294967295;

export function normalizePathPrefix(path) {
  // Deployment prefix like /functions/v1/bell-api must not change semantics.
  if (typeof path !== 'string') throw new TypeError('path must be a string');
  const marker = '/bell-api';
  const index = path.indexOf(marker);
  return index >= 0 ? path.slice(index + marker.length) || '/' : path;
}

export function route(method, rawPath) {
  if (typeof method !== 'string') throw new TypeError('method must be a string');
  const path = normalizePathPrefix(rawPath).replace(/\/+$/, '') || '/';
  const params = {};
  for (const endpoint of ENDPOINTS) {
    if (endpoint.method !== method.toUpperCase()) continue;
    const epParts = endpoint.path.split('/');
    const inParts = path.split('/');
    if (epParts.length !== inParts.length) continue;
    let matched = true;
    for (let i = 0; i < epParts.length; i += 1) {
      const ep = epParts[i];
      const inPart = inParts[i];
      if (ep === inPart) continue;
      if (ep.startsWith('{') && ep.endsWith('}') && inPart.length > 0) {
        params[ep.slice(1, -1)] = decodeURIComponent(inPart);
        continue;
      }
      matched = false;
      break;
    }
    if (matched) return { endpoint, params };
  }
  return null;
}

export function validateChainId(chainId) {
  const n = typeof chainId === 'string' && DECIMAL_STRING.test(chainId) ? Number(chainId) : chainId;
  if (!Number.isInteger(n) || n <= 0 || n > MAX_CHAIN_ID) {
    throw new ValidationError('chainId', 'must be an integer in 1..2^32-1');
  }
  return n;
}

export function validateBoundedLimit(limit, { max = 100, field = 'limit' } = {}) {
  const n = typeof limit === 'string' && DECIMAL_STRING.test(limit) ? Number(limit) : limit;
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new ValidationError(field, `must be an integer in 1..${max}`);
  }
  return n;
}

export function validateHash(hash, field) {
  if (typeof hash !== 'string' || !HEX32.test(hash.toLowerCase())) {
    throw new ValidationError(field, 'must be a 32-byte hex hash');
  }
  return hash.toLowerCase();
}

export function validateAddress(address, field) {
  if (typeof address !== 'string' || !ADDRESS.test(address)) {
    throw new ValidationError(field, 'must be a 20-byte hex address');
  }
  return address.toLowerCase();
}

// Raw amounts cross the API as decimal strings, never JSON numbers: callers
// on any runtime parse them as BigInt without precision loss.
export function validateAmount(amount, field) {
  if (typeof amount !== 'string' || !DECIMAL_STRING.test(amount)) {
    throw new ValidationError(field, 'must be a decimal string');
  }
  return amount;
}

export function validateJsonBody(body, { maxBytes = 64 * 1024 } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('body', 'must be a JSON object');
  }
  if (maxBytes !== Infinity && JSON.stringify(body).length > maxBytes) {
    throw new ValidationError('body', 'exceeds the request size bound');
  }
  return body;
}

export class ValidationError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = 'ValidationError';
    this.field = field;
  }
}

// Response envelope. observedBlock evidence is required for state-reading
// responses; when the dependency is unavailable pass unavailable=true and the
// envelope carries null provenance plus a 503-style status — never fake data.
export function envelope({ chainId, observedBlockNumber, observedBlockHash, observedAt = null, status = 'OK', requestId = null, extra }) {
  if (!Number.isInteger(chainId)) throw new ValidationError('chainId', 'must be an integer');
  if (observedAt !== null && !Number.isSafeInteger(observedAt)) {
    throw new ValidationError('observedAt', 'must be a safe integer timestamp or null');
  }
  const hasBlock = observedBlockNumber !== undefined && observedBlockHash !== undefined;
  if (!hasBlock && status === 'OK') {
    throw new ValidationError('observedBlock', 'state responses require block provenance or status UNAVAILABLE');
  }
  if (hasBlock) {
    if (!Number.isSafeInteger(observedBlockNumber) || observedBlockNumber < 0) {
      throw new ValidationError('observedBlockNumber', 'must be a non-negative integer');
    }
    if (typeof observedBlockHash !== 'string' || !HEX32.test(observedBlockHash)) {
      throw new ValidationError('observedBlockHash', 'must be a 32-byte hex hash');
    }
  }
  return Object.freeze({
    apiVersion: API_VERSION,
    chainId,
    status,
    observedAt: observedAt ?? null,
    observedBlockNumber: hasBlock ? observedBlockNumber : null,
    observedBlockHash: hasBlock ? observedBlockHash : null,
    requestId: requestId ?? null,
    ...extra,
  });
}

// Quote expiry and tooling deadline have normative maxima from the brief.
export function validateQuoteExpiry(seconds) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) {
    throw new ValidationError('quoteExpirySeconds', 'must be an integer in 1..30 per the brief');
  }
  return seconds;
}

export function validateDeadline(seconds) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) {
    throw new ValidationError('deadlineSeconds', 'must be an integer in 1..120 per the brief');
  }
  return seconds;
}

export const ERROR_SEMANTICS = Object.freeze({
  VALIDATION: { http: 400, retryable: false },
  NOT_FOUND: { http: 404, retryable: false },
  CONFLICT: { http: 409, retryable: false },
  RATE_LIMITED: { http: 429, retryable: true },
  UNAVAILABLE: { http: 503, retryable: true },
  INTERNAL: { http: 500, retryable: false },
});

export function errorBody(kind, options = {}) {
  const { message, field, retryAfterSeconds, requestId } = options;
  const semantics = ERROR_SEMANTICS[kind];
  if (!semantics) throw new ValidationError('kind', 'unknown error kind');
  return Object.freeze({
    apiVersion: API_VERSION,
    error: {
      kind,
      http: semantics.http,
      code: kind,
      message: message ?? null,
      field: field ?? null,
      retryAfter: semantics.retryable ? (retryAfterSeconds ?? 30) : null,
      requestId: requestId ?? null,
    },
  });
}
