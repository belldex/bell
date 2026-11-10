import { describe, expect, it } from 'vitest';
import { parsePoolStatusRequest, lensForPool, integrationPoolFields } from '../src/pool-status.mjs';

const POOL = `0x${'ab'.repeat(32)}`;
const LENS = `0x${'12'.repeat(20)}`;

describe('public Lens status route validation', () => {
  it('recognizes only a 32-byte pool status path', () => {
    expect(parsePoolStatusRequest(`/pools/${POOL}/status`)).toEqual({ poolId: POOL });
    expect(parsePoolStatusRequest('/pools/nope/status')).toEqual({ error: 'invalid pool id' });
    expect(parsePoolStatusRequest('/pools/not-status')).toBeNull();
  });

  it('requires a direction and a raw integer amount', () => {
    const valid = new URLSearchParams({ zeroForOne: 'true', amountIn: '12345' });
    expect(parsePoolStatusRequest(`/pools/${POOL}/status`, valid)).toEqual({ poolId: POOL, zeroForOne: true, amountIn: 12345n });
    expect(parsePoolStatusRequest(`/pools/${POOL}/status`, new URLSearchParams({ zeroForOne: '1', amountIn: '1' })).error).toMatch(/zeroForOne/);
    expect(parsePoolStatusRequest(`/pools/${POOL}/status`, new URLSearchParams({ zeroForOne: 'false', amountIn: '-1' })).error).toMatch(/amountIn/);
    expect(parsePoolStatusRequest(`/pools/${POOL}/status`, new URLSearchParams({ zeroForOne: 'false', amountIn: '1e6' })).error).toMatch(/amountIn/);
  });

  it('resolves a normalized poolId to a valid configured Lens address', () => {
    expect(lensForPool(JSON.stringify({ [POOL.toUpperCase().replace('0X', '0x')]: LENS }), POOL)).toBe(LENS);
    expect(lensForPool('{}', POOL)).toBeNull();
    expect(lensForPool('{', POOL)).toBeNull();
    expect(lensForPool(JSON.stringify({ [POOL]: '0x1234' }), POOL)).toBeNull();
  });

  it('adds explicit auction and Lens fields to the live pool JSON', () => {
    const [withAuction, withoutAuction] = integrationPoolFields([
      { poolId: POOL, auction: LENS },
      { poolId: `0x${'cd'.repeat(32)}`, auction: null },
    ], JSON.stringify({ [POOL]: LENS }), { [POOL]: { address: LENS } });
    expect(withAuction).toMatchObject({ poolId: POOL, hasAuction: true, lens: LENS });
    expect(withoutAuction).toMatchObject({ hasAuction: false, lens: null });
    expect(integrationPoolFields([{ poolId: POOL }], '{}')[0].hasAuction).toBeNull();
  });
});
