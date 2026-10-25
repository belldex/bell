const ALARM_INTERVAL_MS = 30_000;

export function nextAlarmTimestamp(nowMilliseconds) {
  if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0) {
    throw new RangeError('alarm time must be a non-negative safe integer');
  }
  return (Math.floor(nowMilliseconds / ALARM_INTERVAL_MS) + 1) * ALARM_INTERVAL_MS;
}

export class KeeperState {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (url.pathname === '/ensure-alarm') {
      const alarmAt = await this.ensureAlarm();
      return Response.json({ alarmAt });
    }
    if (url.pathname === '/status') {
      return Response.json({
        alarmAt: await this.ctx.storage.getAlarm(),
        tickCount: (await this.ctx.storage.get('tickCount')) ?? 0,
      });
    }
    return new Response('Not found', { status: 404 });
  }

  async ensureAlarm() {
    const desired = nextAlarmTimestamp(Date.now());
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > desired) await this.ctx.storage.setAlarm(desired);
    return await this.ctx.storage.getAlarm();
  }

  async alarm() {
    // Persist the next wakeup before any source/RPC work is added to this handler.
    await this.ensureAlarm();
    const current = await this.ctx.storage.get('tickCount');
    const safeCount = Number.isSafeInteger(current) && current >= 0 ? current : 0;
    await this.ctx.storage.put('tickCount', safeCount + 1);
  }
}
