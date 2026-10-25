import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Keeper B durable alarm coordinator', () => {
  it('persists one future alarm and schedules the next alarm before recording a tick', async () => {
    const stub = env.KEEPER_DO.get(env.KEEPER_DO.idFromName('alarm-basic'));
    const initial = await stub.fetch('https://bell.test/ensure-alarm');
    const initialState = await initial.json() as { alarmAt: number | null };
    expect(initialState.alarmAt).toBeGreaterThan(Date.now());

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const status = await (await stub.fetch('https://bell.test/status')).json() as { tickCount: number; alarmAt: number | null };
    expect(status.tickCount).toBe(1);
    expect(status.alarmAt).toBeGreaterThan(Date.now());
  });

  it('does not postpone an earlier alarm during ensureAlarm', async () => {
    const stub = env.KEEPER_DO.get(env.KEEPER_DO.idFromName('alarm-early'));
    const result = await runInDurableObject(stub, async (instance: { fetch(request: Request): Promise<Response> }, state) => {
      const earlier = Date.now() + 5000;
      await state.storage.setAlarm(earlier);
      const response = await instance.fetch(new Request('https://bell.test/ensure-alarm'));
      return { earlier, alarmAt: (await response.json() as { alarmAt: number }).alarmAt };
    });
    expect(result.alarmAt).toBeLessThanOrEqual(result.earlier);
    expect(result.alarmAt).toBeGreaterThan(Date.now());
  });
});
