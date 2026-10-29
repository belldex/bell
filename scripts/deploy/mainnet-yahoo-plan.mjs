import { getContractAddress } from 'viem';
import { buildYahooSourceWire } from '../../packages/protocol/src/yahoo-attestation.mjs';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

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
