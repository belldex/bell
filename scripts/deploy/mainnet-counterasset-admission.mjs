import { encodeAbiParameters, keccak256, stringToHex } from 'viem';

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ZERO32 = `0x${'0'.repeat(64)}`;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;

function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

export function validateCounterassetObservation(candidate, observed, { allowAlreadyActive = false } = {}) {
  for (const field of ['symbol', 'name', 'token', 'tokenCodeHash', 'implementation', 'implementationCodeHash']) {
    if (!candidate?.[field] || !observed?.[field] || !same(candidate[field], observed[field])) {
      throw new Error(`counterasset ${field} does not match its reviewed evidence`);
    }
  }
  if (Number(observed.chainId) !== 4663 || Number(candidate.chainId) !== 4663) throw new Error('counterasset is not on Robinhood Chain Mainnet');
  if (Number(observed.decimals) !== Number(candidate.decimals) || Number(observed.decimals) > 18) throw new Error('counterasset decimals do not match reviewed evidence');
  if (observed.clone !== true) throw new Error('counterasset clone runtime does not match the reviewed EIP-1167 implementation');
  if (observed.registryDescriptorId && !same(observed.registryDescriptorId, ZERO32) && !allowAlreadyActive) throw new Error('counterasset is already admitted; use its active registry descriptor');
  if (candidate.isStock !== false || Number(candidate.capabilityMask ?? 0) !== 0) throw new Error('counterasset evidence must not grant stock capabilities');
  if (!BYTES32.test(candidate.evidenceHash ?? '') || same(candidate.evidenceHash, ZERO32)) throw new Error('counterasset evidence hash is missing');
  return { eligible: true, poolClasses: ['SESSION_ONLY'] };
}

export function buildCounterassetDescriptor(candidate) {
  if (!ADDRESS.test(candidate.token ?? '') || !ADDRESS.test(candidate.implementation ?? '')
    || !BYTES32.test(candidate.tokenCodeHash ?? '') || !BYTES32.test(candidate.implementationCodeHash ?? '')
    || !BYTES32.test(candidate.evidenceHash ?? '')) throw new TypeError('counterasset candidate is malformed');
  const implementationFingerprint = keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes32' }],
    [candidate.implementation, candidate.implementationCodeHash],
  ));
  return {
    id: ZERO32, token: candidate.token, isStock: false, decimals: Number(candidate.decimals), capabilityMask: 0,
    tokenPriceAdapter: ZERO_ADDRESS, regularAdapter: ZERO_ADDRESS, extendedAdapter: ZERO_ADDRESS,
    overnightAdapter: ZERO_ADDRESS, secondaryAdapter: ZERO_ADDRESS,
    expectedCodeHash: candidate.tokenCodeHash, implementationFingerprint, evidenceHash: candidate.evidenceHash,
  };
}

export function counterassetEvidenceHash(evidence) {
  return keccak256(stringToHex(JSON.stringify(evidence)));
}
