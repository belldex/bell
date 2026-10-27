import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { canonicalTokenId } from './identity.mjs';

export const YAHOO_REPORT_SCHEMA = 12;
export const BELL_MAX_YAHOO_AGE_SECONDS = 120;
const ZERO32 = `0x${'00'.repeat(32)}`;
const SOURCE_TAG = 'BELL_YAHOO_REPORT_V1';
const EIP712_DOMAIN_TYPEHASH = keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
const YAHOO_QUOTE_TYPEHASH = keccak256(stringToHex('YahooQuote(bytes32 sourceConfigHash,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash)'));
const DOMAIN_NAME_HASH = keccak256(stringToHex('BELL Yahoo Quote Reporter'));
const DOMAIN_VERSION_HASH = keccak256(stringToHex('1'));
const YAHOO_TOKEN_STATUS_TYPEHASH = keccak256(stringToHex('YahooTokenStatus(address token,uint128 multiplier18,uint128 pendingMultiplier18,uint64 effectiveAt,uint64 observedAt,bool oraclePaused,bytes32 codeHash)'));

export function yahooFeedId(symbol, phaseScope) {
  const ticker = typeof symbol === 'string' ? symbol.toUpperCase() : '';
  if (!/^[A-Z][A-Z0-9.^=-]{0,15}$/.test(ticker)) throw new TypeError('invalid Yahoo ticker');
  if (![1, 2, 3].includes(phaseScope)) throw new RangeError('stream phaseScope must be 1, 2, or 3');
  return keccak256(stringToHex(`${SOURCE_TAG}:${ticker}:SCOPE:${phaseScope}`));
}

/** Build the exact SourceWire tuple/hash consumed by SourceConfigHash.hash onchain. */
export function buildYahooSourceWire({
  chainId,
  token,
  verifier,
  verifierCodeHash,
  phaseScope,
  symbol,
} = {}) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError('chainId must be a positive safe integer');
  if (!/^0x[0-9a-f]{40}$/i.test(token ?? '')) throw new TypeError('token must be an EVM address');
  if (!/^0x[0-9a-f]{40}$/i.test(verifier ?? '')) throw new TypeError('verifier must be an EVM address');
  if (!/^0x[0-9a-f]{64}$/i.test(verifierCodeHash ?? '') || verifierCodeHash.toLowerCase() === ZERO32) {
    throw new TypeError('verifierCodeHash must be nonzero bytes32');
  }
  if (![0, 1, 2, 3].includes(phaseScope)) throw new RangeError('phaseScope must be 0, 1, 2, or 3');

  const canonicalId = canonicalTokenId(BigInt(chainId), token);
  const directPrice = phaseScope === 0;
  const feedId = directPrice ? ZERO32 : yahooFeedId(symbol, phaseScope);
  const wire = Object.freeze({
    kind: directPrice ? 1 : 3,
    phaseScope,
    endpoint: verifier.toLowerCase(),
    feedId,
    schema: directPrice ? 0 : YAHOO_REPORT_SCHEMA,
    decimals: 18,
    priceBasis: directPrice ? 2 : 1,
    heartbeatSec: BELL_MAX_YAHOO_AGE_SECONDS,
    expectedCodeHash: verifierCodeHash.toLowerCase(),
    expectedImplementation: verifier.toLowerCase(),
    canonicalTokenId: canonicalId,
  });
  const encoded = encodeAbiParameters(
    parseAbiParameters('uint8,uint8,address,bytes32,uint16,uint8,uint8,uint32,bytes32,address,bytes32'),
    [wire.kind, wire.phaseScope, wire.endpoint, wire.feedId, wire.schema, wire.decimals,
      wire.priceBasis, wire.heartbeatSec, wire.expectedCodeHash, wire.expectedImplementation, wire.canonicalTokenId],
  );
  return Object.freeze({ wire, canonicalTokenId: canonicalId, sourceConfigHash: keccak256(encoded) });
}

const SOURCE_SAMPLE_ABI = {
  type: 'tuple',
  components: [
    { name: 'descriptorId', type: 'bytes32' },
    { name: 'feedId', type: 'bytes32' },
    { name: 'phase', type: 'uint8' },
    { name: 'price18', type: 'uint128' },
    { name: 'observedAt', type: 'uint64' },
    { name: 'inputAt', type: 'uint64' },
    { name: 'validFrom', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'validUntil', type: 'uint64' },
    { name: 'reportHash', type: 'bytes32' },
  ],
};

function uint(value, label) {
  const parsed = typeof value === 'bigint' ? value : BigInt(value);
  if (parsed < 0n) throw new RangeError(`${label} must be non-negative`);
  return parsed;
}

function phaseCode(phase) {
  if (phase === 'PRE') return 1;
  if (phase === 'REGULAR') return 2;
  if (phase === 'POST') return 3;
  if (phase === 'OVERNIGHT') return 4;
  throw new Error(`Yahoo phase is not eligible for source admission: ${phase}`);
}

function phaseMatchesScope(phase, phaseScope) {
  if (phaseScope === 0) return true; // direct adjusted-token quote
  if (phaseScope === 1) return phase === 2;
  if (phaseScope === 2) return phase === 1 || phase === 3;
  if (phaseScope === 3) return phase === 4;
  return false;
}

export function buildYahooSourceSample(quote, {
  feedId,
  phaseScope,
  nowSeconds = Math.floor(Date.now() / 1000),
  tokenMultiplier18 = '1000000000000000000',
} = {}) {
  if (!quote || quote.source !== 'YAHOO_CHART_API' || quote.currency !== 'USD') {
    throw new TypeError('quote must be a parsed Yahoo USD chart quote');
  }
  if (!Number.isInteger(phaseScope) || phaseScope < 0 || phaseScope > 3) {
    throw new RangeError('phaseScope must be 0 (direct), 1 (regular), 2 (extended), or 3 (overnight)');
  }
  if (phaseScope === 0) {
    if (feedId !== ZERO32) throw new Error('direct adjusted-token quote requires zero feedId');
  } else if (!/^0x[0-9a-f]{64}$/i.test(feedId ?? '') || feedId.toLowerCase() === ZERO32) {
    throw new TypeError('stream phase requires a nonzero bytes32 feedId');
  }
  const phase = phaseScope === 0 ? 0 : phaseCode(quote.phase);
  if (!phaseMatchesScope(phase, phaseScope)) throw new Error(`Yahoo phase mismatch for source scope ${phaseScope}`);

  const now = uint(nowSeconds, 'nowSeconds');
  const observedAt = uint(quote.observedAt, 'observedAt');
  const inputAt = uint(quote.inputAt, 'inputAt');
  const underlyingPrice = uint(quote.priceRaw18, 'priceRaw18');
  const multiplier = uint(tokenMultiplier18, 'tokenMultiplier18');
  if (underlyingPrice === 0n || multiplier === 0n) throw new RangeError('price and token multiplier must be positive');
  if (observedAt > now || inputAt > now) throw new Error('Yahoo quote timestamp is in the future');
  if (now - observedAt >= BigInt(BELL_MAX_YAHOO_AGE_SECONDS)
    || now - inputAt >= BigInt(BELL_MAX_YAHOO_AGE_SECONDS)) throw new Error('Yahoo quote is stale for BELL policy');
  const price18 = phaseScope === 0 ? underlyingPrice * multiplier / 10n ** 18n : underlyingPrice;
  if (price18 === 0n || price18 > (1n << 128n) - 1n) throw new RangeError('adjusted price is outside uint128');

  const validUntil = observedAt + BigInt(BELL_MAX_YAHOO_AGE_SECONDS);
  const expiresAt = validUntil;
  if (validUntil <= now || validUntil > (1n << 64n) - 1n) throw new Error('Yahoo report has no remaining validity');
  const inputAt64 = inputAt;
  const observedAt64 = observedAt;
  for (const [field, value] of [['inputAt', inputAt64], ['observedAt', observedAt64], ['validFrom', observedAt], ['expiresAt', expiresAt], ['validUntil', validUntil]]) {
    if (value > (1n << 64n) - 1n) throw new RangeError(`${field} exceeds uint64`);
  }

  const reportHash = keccak256(encodeAbiParameters(
    parseAbiParameters('string source, string symbol, bytes32 feedId, uint8 phase, uint128 price18, uint64 observedAt, uint64 inputAt, uint64 validUntil'),
    [SOURCE_TAG, quote.symbol, phaseScope === 0 ? ZERO32 : feedId, phase, price18, observedAt, inputAt, validUntil],
  ));

  return Object.freeze({
    descriptorId: ZERO32,
    feedId: phaseScope === 0 ? ZERO32 : feedId,
    phase,
    price18,
    observedAt,
    inputAt,
    validFrom: observedAt,
    expiresAt,
    validUntil,
    reportHash,
    symbol: quote.symbol,
    tokenMultiplier18: multiplier,
    source: SOURCE_TAG,
  });
}

export async function signYahooSourceSample(sample, {
  sourceConfigHash,
  chainId,
  verifier,
  privateKey,
} = {}) {
  if (!/^0x[0-9a-f]{64}$/i.test(sourceConfigHash ?? '') || sourceConfigHash.toLowerCase() === ZERO32) {
    throw new TypeError('sourceConfigHash must be nonzero bytes32');
  }
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError('chainId must be a positive safe integer');
  if (!/^0x[0-9a-f]{40}$/i.test(verifier ?? '')) throw new TypeError('verifier must be an EVM address');
  if (typeof privateKey !== 'string' || !/^0x[0-9a-f]{64}$/i.test(privateKey)) {
    throw new TypeError('privateKey must be a 32-byte hex key');
  }
  const account = privateKeyToAccount(privateKey);
  const message = {
    sourceConfigHash,
    feedId: sample.feedId,
    phase: sample.phase,
    price18: sample.price18,
    observedAt: sample.observedAt,
    inputAt: sample.inputAt,
    validFrom: sample.validFrom,
    expiresAt: sample.expiresAt,
    validUntil: sample.validUntil,
    reportHash: sample.reportHash,
  };
  const domain = { name: 'BELL Yahoo Quote Reporter', version: '1', chainId, verifyingContract: verifier };
  const domainSeparator = keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32,bytes32,bytes32,uint256,address'),
    [EIP712_DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, BigInt(chainId), verifier],
  ));
  const structHash = keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32,bytes32,bytes32,uint8,uint128,uint64,uint64,uint64,uint64,uint64,bytes32'),
    [YAHOO_QUOTE_TYPEHASH, sourceConfigHash, sample.feedId, sample.phase, sample.price18,
      sample.observedAt, sample.inputAt, sample.validFrom, sample.expiresAt, sample.validUntil, sample.reportHash],
  ));
  const eip712Digest = keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}`);
  const typedData = {
    domain,
    types: {
      YahooQuote: [
        { name: 'sourceConfigHash', type: 'bytes32' },
        { name: 'feedId', type: 'bytes32' },
        { name: 'phase', type: 'uint8' },
        { name: 'price18', type: 'uint128' },
        { name: 'observedAt', type: 'uint64' },
        { name: 'inputAt', type: 'uint64' },
        { name: 'validFrom', type: 'uint64' },
        { name: 'expiresAt', type: 'uint64' },
        { name: 'validUntil', type: 'uint64' },
        { name: 'reportHash', type: 'bytes32' },
      ],
    },
    primaryType: 'YahooQuote',
    message,
  };
  const signature = await account.signTypedData(typedData);
  if (signature.slice(-2).toLowerCase() === '00') {
    // ECDSA recovery rejects the legacy 0/1 recovery-byte convention; normalize to 27/28.
    const v = Number.parseInt(signature.slice(-2), 16) + 27;
    const normalizedSignature = `${signature.slice(0, -2)}${v.toString(16).padStart(2, '0')}`;
    const report = encodeAbiParameters([SOURCE_SAMPLE_ABI, { type: 'bytes' }], [sample, normalizedSignature]);
    return Object.freeze({ reporter: account.address, signature: normalizedSignature, report, typedData, digest: eip712Digest });
  }
  const report = encodeAbiParameters([SOURCE_SAMPLE_ABI, { type: 'bytes' }], [
    {
      descriptorId: sample.descriptorId,
      feedId: sample.feedId,
      phase: sample.phase,
      price18: sample.price18,
      observedAt: sample.observedAt,
      inputAt: sample.inputAt,
      validFrom: sample.validFrom,
      expiresAt: sample.expiresAt,
      validUntil: sample.validUntil,
      reportHash: sample.reportHash,
    },
    signature,
  ]);
  return Object.freeze({ reporter: account.address, signature, report, typedData, digest: eip712Digest });
}

export async function signYahooTokenStatus({ token, multiplier18, pendingMultiplier18, effectiveAt, observedAt, oraclePaused, codeHash }, {
  chainId,
  verifier,
  privateKey,
} = {}) {
  if (!/^0x[0-9a-f]{40}$/i.test(token ?? '') || !/^0x[0-9a-f]{64}$/i.test(codeHash ?? '')) {
    throw new TypeError('token/codeHash must be an address and bytes32');
  }
  if (typeof oraclePaused !== 'boolean') throw new TypeError('oraclePaused must be boolean');
  const current = uint(multiplier18, 'multiplier18');
  const pending = uint(pendingMultiplier18, 'pendingMultiplier18');
  const appliedAt = uint(effectiveAt, 'effectiveAt');
  const observed = uint(observedAt, 'observedAt');
  if (current === 0n || pending === 0n || appliedAt > (1n << 64n) - 1n || observed > (1n << 64n) - 1n
    || (appliedAt === 0n && current !== pending) || (appliedAt !== 0n && appliedAt <= observed && current !== pending)) {
    throw new RangeError('token status is inconsistent or outside onchain widths');
  }
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError('chainId must be positive');
  if (!/^0x[0-9a-f]{40}$/i.test(verifier ?? '')) throw new TypeError('verifier must be an address');
  if (typeof privateKey !== 'string' || !/^0x[0-9a-f]{64}$/i.test(privateKey)) throw new TypeError('privateKey must be a 32-byte key');
  const account = privateKeyToAccount(privateKey);
  const domain = { name: 'BELL Yahoo Token Status', version: '1', chainId, verifyingContract: verifier };
  const message = {
    token,
    multiplier18: current,
    pendingMultiplier18: pending,
    effectiveAt: appliedAt,
    observedAt: observed,
    oraclePaused,
    codeHash,
  };
  const typedData = {
    domain,
    types: { YahooTokenStatus: [
      { name: 'token', type: 'address' },
      { name: 'multiplier18', type: 'uint128' },
      { name: 'pendingMultiplier18', type: 'uint128' },
      { name: 'effectiveAt', type: 'uint64' },
      { name: 'observedAt', type: 'uint64' },
      { name: 'oraclePaused', type: 'bool' },
      { name: 'codeHash', type: 'bytes32' },
    ] },
    primaryType: 'YahooTokenStatus',
    message,
  };
  const signature = await account.signTypedData(typedData);
  const normalizedSignature = signature.slice(-2).toLowerCase() === '00'
    ? `${signature.slice(0, -2)}${(Number.parseInt(signature.slice(-2), 16) + 27).toString(16).padStart(2, '0')}`
    : signature;
  const eip712Domain = keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32,bytes32,bytes32,uint256,address'),
    [EIP712_DOMAIN_TYPEHASH, keccak256(stringToHex(domain.name)), DOMAIN_VERSION_HASH, BigInt(chainId), verifier],
  ));
  const structHash = keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32,address,uint128,uint128,uint64,uint64,bool,bytes32'),
    [YAHOO_TOKEN_STATUS_TYPEHASH, token, current, pending, appliedAt, observed, oraclePaused, codeHash],
  ));
  return Object.freeze({ reporter: account.address, signature: normalizedSignature, typedData,
    digest: keccak256(`0x1901${eip712Domain.slice(2)}${structHash.slice(2)}`) });
}
