// BigInt reference implementation for vectors; this is not the required 768-bit Solidity limb implementation.
const Q192 = 1n << 192n;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;

function validateDomain(sqrtPriceX96, price0, price1, decimals0, decimals1, bandBps) {
  if (typeof sqrtPriceX96 !== 'bigint' || sqrtPriceX96 <= 0n || sqrtPriceX96 > MAX_UINT160) {
    throw new RangeError('sqrtPriceX96 must be a positive uint160');
  }
  for (const [price, name] of [[price0, 'price0'], [price1, 'price1']]) {
    if (typeof price !== 'bigint' || price <= 0n || price > MAX_UINT128) {
      throw new RangeError(`${name} must be a positive uint128`);
    }
  }
  for (const [decimals, name] of [[decimals0, 'decimals0'], [decimals1, 'decimals1']]) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new RangeError(`${name} must be from zero through 18`);
    }
  }
  if (bandBps !== 200 && bandBps !== 500) throw new RangeError('band must be 200 or 500 bps');
}

function comparePrice(sqrtPriceX96, price0, price1, decimals0, decimals1, bandBps) {
  validateDomain(sqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
  const lhs = sqrtPriceX96 * sqrtPriceX96 * price1 * (10n ** BigInt(decimals0)) * 10000n;
  const referenceScale = Q192 * price0 * (10n ** BigInt(decimals1));
  return {
    lhs,
    lower: referenceScale * BigInt(10000 - bandBps),
    upper: referenceScale * BigInt(10000 + bandBps),
  };
}

export function isWithinPriceBand(sqrtPriceX96, price0, price1, decimals0, decimals1, bandBps) {
  const { lhs, lower, upper } = comparePrice(sqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
  return lower <= lhs && lhs <= upper;
}

export function allowsPricePath(preSqrtPriceX96, postSqrtPriceX96, price0, price1, decimals0, decimals1, bandBps) {
  validateDomain(preSqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
  validateDomain(postSqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
  const pre = comparePrice(preSqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
  const post = comparePrice(postSqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
  if (pre.lower <= pre.lhs && pre.lhs <= pre.upper) return post.lower <= post.lhs && post.lhs <= post.upper;
  if (pre.lhs < pre.lower) return postSqrtPriceX96 > preSqrtPriceX96 && post.lhs <= post.upper;
  return postSqrtPriceX96 < preSqrtPriceX96 && post.lhs >= post.lower;
}
