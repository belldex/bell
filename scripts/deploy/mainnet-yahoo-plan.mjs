import { getContractAddress, keccak256 } from 'viem';
import { buildYahooSourceWire } from '../../packages/protocol/src/yahoo-attestation.mjs';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** Hash the deployed verifier runtime after filling Solidity immutable references. */
export function verifierRuntimeCodeHash({ deployedBytecode, immutableReferences, reporter } = {}) {
  if (typeof deployedBytecode !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(deployedBytecode)) {
    throw new TypeError('deployedBytecode must be nonempty even-length hex');
  }
  if (!ADDRESS.test(reporter ?? '')) throw new TypeError('reporter must be an EVM address');
  if (!immutableReferences || typeof immutableReferences !== 'object') {
    throw new TypeError('immutableReferences are required to calculate runtime code hash');
  }

  const runtime = deployedBytecode.slice(2).toLowerCase().split('');
  const reporterWord = reporter.slice(2).toLowerCase().padStart(64, '0');
  let references = 0;
  for (const locations of Object.values(immutableReferences)) {
    if (!Array.isArray(locations)) throw new TypeError('immutable reference locations must be arrays');
    for (const location of locations) {
      if (!Number.isSafeInteger(location?.start) || location.start < 0
        || !Number.isSafeInteger(location?.length) || location.length <= 0 || location.length > 32) {
        throw new RangeError('immutable reference start/length is invalid');
      }
      const replacement = reporterWord.slice(64 - location.length * 2);
      const start = location.start * 2;
      if (start + replacement.length > runtime.length) throw new RangeError('immutable reference is outside deployedBytecode');
      for (let i = 0; i < replacement.length; i += 1) runtime[start + i] = replacement[i];
      references += 1;
    }
  }
  if (references === 0) throw new Error('no immutable reporter references found in verifier artifact');
  return keccak256(`0x${runtime.join('')}`);
}

/**
 * Compute the verifier address and adapter wire hashes before deployment.
 *
 * A CREATE address depends only on the deployer and its nonce. Plan-only can therefore produce
 * the exact wire hashes without an existing verifier address. The broadcaster must deploy the
 * verifier first at this predicted address, verify it landed there, and only then deploy adapters.
 */
export function buildMainnetYahooPlan({
  deployer,
  deployerNonce,
  token,
  verifierCodeHash,
  symbol,
  reporter,
  verifierAddress,
} = {}) {
  if (!ADDRESS.test(deployer ?? '')) throw new TypeError('deployer must be an EVM address');
  if (typeof deployerNonce !== 'bigint' && !(typeof deployerNonce === 'number' && Number.isSafeInteger(deployerNonce) && deployerNonce >= 0)) {
    throw new TypeError('deployerNonce must be a non-negative integer');
  }
  const nonce = BigInt(deployerNonce);
  if (nonce < 0n || nonce > (1n << 64n) - 1n) throw new RangeError('deployerNonce is outside uint64');
  if (!ADDRESS.test(token ?? '')) throw new TypeError('token must be an EVM address');
  if (!BYTES32.test(verifierCodeHash ?? '') || /^0x0{64}$/i.test(verifierCodeHash)) {
    throw new TypeError('verifierCodeHash must be a nonzero bytes32');
  }
  if (!ADDRESS.test(reporter ?? '')) throw new TypeError('reporter must be an EVM address');
  if (typeof symbol !== 'string' || !/^[A-Z][A-Z0-9.^=-]{0,15}$/.test(symbol)) throw new TypeError('symbol is invalid');

  const predicted = getContractAddress({ from: deployer, nonce });
  if (verifierAddress !== undefined && !ADDRESS.test(verifierAddress)) {
    throw new TypeError('verifierAddress must be an EVM address when supplied');
  }
  const chosenAddress = verifierAddress ?? predicted;
  const scopes = [
    { scope: 0, key: 'directWire', label: 'direct' },
    { scope: 1, key: 'regularWire', label: 'regular' },
    { scope: 2, key: 'extendedWire', label: 'extended' },
  ];
  const wires = scopes.map((scopeInfo) => ({
    ...scopeInfo,
    ...buildYahooSourceWire({
      chainId: 4663,
      token,
      verifier: chosenAddress,
      verifierCodeHash,
      phaseScope: scopeInfo.scope,
      symbol,
    }),
  }));

  return Object.freeze({
    chainId: 4663,
    deployer,
    deployerNonce: nonce,
    predictedVerifierAddress: predicted,
    verifierAddress: chosenAddress,
    verifierAddressSource: verifierAddress === undefined ? 'predicted' : 'provided',
    token,
    verifierCodeHash: verifierCodeHash.toLowerCase(),
    reporter,
    symbol,
    wires: Object.freeze(wires),
  });
}
