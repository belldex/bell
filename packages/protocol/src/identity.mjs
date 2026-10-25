import { encodeAbiParameters, keccak256, toFunctionSelector } from 'viem';

const MAX_UINT256 = (1n << 256n) - 1n;
const ADDRESS = /^0x[0-9a-f]{40}$/i;

export function canonicalTokenId(chainId, token) {
  if (typeof chainId !== 'bigint' || chainId <= 0n || chainId > MAX_UINT256) {
    throw new RangeError('chainId must be a positive uint256 bigint');
  }
  if (typeof token !== 'string' || !ADDRESS.test(token)) throw new TypeError('token must be a 20-byte hex address');
  return keccak256(encodeAbiParameters(
    [{ name: 'chainId', type: 'uint256' }, { name: 'token', type: 'address' }],
    [chainId, token],
  ));
}

export function functionSelector(signature) {
  if (typeof signature !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*\([^;]*\)$/.test(signature)) {
    throw new TypeError('function signature must be canonical Solidity signature text');
  }
  return toFunctionSelector(signature).toLowerCase();
}

export function hashEvmCode(code) {
  if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(code)) {
    throw new TypeError('EVM runtime code must be even-length hex bytes');
  }
  return keccak256(code.toLowerCase());
}
