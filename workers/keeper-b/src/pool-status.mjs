const POOL_ID = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_UINT256 = (1n << 256n) - 1n;

export function parsePoolStatusRequest(pathname, searchParams = null) {
  const match = /^\/pools\/([^/]+)\/status$/.exec(pathname);
  if (!match) return null;
  if (!POOL_ID.test(match[1])) return { error: 'invalid pool id' };
  const poolId = match[1].toLowerCase();
  if (searchParams === null) return { poolId };
  const direction = searchParams.get('zeroForOne');
  if (direction !== 'true' && direction !== 'false') return { error: 'zeroForOne must be true or false' };
  const raw = searchParams.get('amountIn');
  if (raw === null || !/^\d+$/.test(raw)) return { error: 'amountIn must be a raw uint256 integer' };
  const amountIn = BigInt(raw);
  if (amountIn > MAX_UINT256) return { error: 'amountIn exceeds uint256' };
  return { poolId, zeroForOne: direction === 'true', amountIn };
}

export function lensForPool(rawMap, poolId) {
  if (typeof rawMap !== 'string' || !POOL_ID.test(poolId)) return null;
  let map;
  try { map = JSON.parse(rawMap); } catch { return null; }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const key = Object.keys(map).find((candidate) => candidate.toLowerCase() === poolId.toLowerCase());
  const lens = key === undefined ? undefined : map[key];
  return typeof lens === 'string' && ADDRESS.test(lens) ? lens : null;
}

export function integrationPoolFields(pools, rawMap, auctions = null) {
  return pools.map((pool) => ({
    ...pool,
    hasAuction: auctions === null ? null : Boolean(auctions[pool.poolId]?.address),
    auction: auctions === null ? null : auctions[pool.poolId]?.address ?? null,
    lens: lensForPool(rawMap, pool.poolId),
  }));
}
