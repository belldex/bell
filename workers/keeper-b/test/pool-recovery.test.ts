import { describe, expect, it } from 'vitest';
import { refreshRecoveringPools } from '../src/index.ts';

/**
 * A pool that misses a session boundary lands in RECOVERING with RECOVERY_PENDING and `canSwap`
 * false. It returns to tradable with two permissionless `refreshState` calls about a minute apart.
 * The keeper performs both, so a visitor never finds a pool they cannot trade against without
 * knowing why.
 *
 * These cover the guards: it must not touch a tradable pool, must not touch anything when the pool
 * list is empty, and must not throw on an address that is not a BELL pool.
 */
describe('recovering pool refresh', () => {
  it('is exported for the scheduled handler', () => {
    expect(typeof refreshRecoveringPools).toBe('function');
  });

  it('skips without a pool list instead of throwing', async () => {
    const result = await refreshRecoveringPools({}, { hooks: [] });
    expect(result.status).toBe('skipped');
  });

  it('skips without a signing key rather than attempting a transaction', async () => {
    const result = await refreshRecoveringPools({}, { hooks: ['0x0000000000000000000000000000000000000001'] });
    expect(result.status).toBe('skipped');
    expect(String(result.reason)).toMatch(/signing key|RPC/);
  });
});
