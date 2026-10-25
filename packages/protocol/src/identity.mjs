import { encodeAbiParameters, keccak256 } from 'viem';

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
