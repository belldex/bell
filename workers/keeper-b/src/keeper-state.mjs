/**
 * Durable Object that owns the keeper schedule and its observable state.
 *
 * The alarm is persisted before any network work, so a crash mid-tick still leaves the next
 * wakeup scheduled. Every tick result (published / skipped / failed) is stored so /status can
 * explain why the keeper is not publishing instead of leaving a silent gap.
 */
import { runTick } from './index.ts';

const ALARM_INTERVAL_MS = 30_000;
const HISTORY_LIMIT = 20;

export function nextAlarmTimestamp(nowMilliseconds) {
  if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0) {
    throw new RangeError('alarm time must be a non-negative safe integer');
  }
  return (Math.floor(nowMilliseconds / ALARM_INTERVAL_MS) + 1) * ALARM_INTERVAL_MS;
}

export class KeeperState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
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
        publishedCount: (await this.ctx.storage.get('publishedCount')) ?? 0,
        lastResult: (await this.ctx.storage.get('lastResult')) ?? null,
        lastTickAt: (await this.ctx.storage.get('lastTickAt')) ?? null,
        history: (await this.ctx.storage.get('history')) ?? [],
      });
    }
    if (url.pathname === '/tick') {
      const result = await this.tick();
      return Response.json(result);
    }
    return new Response('Not found', { status: 404 });
  }

  async ensureAlarm() {
    const desired = nextAlarmTimestamp(Date.now());
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > desired) await this.ctx.storage.setAlarm(desired);
    return await this.ctx.storage.getAlarm();
  }

  async tick() {
    // Persist the next wakeup before any network work so a crash cannot stop the schedule.
    await this.ensureAlarm();
    const at = new Date().toISOString();
    let result;
    try {
      result = await runTick(this.env);
    } catch (error) {
      result = { status: 'failed', reason: String(error?.message ?? error).slice(0, 300) };
    }

    const current = await this.ctx.storage.get('tickCount');
    const safeCount = Number.isSafeInteger(current) && current >= 0 ? current : 0;
    await this.ctx.storage.put('tickCount', safeCount + 1);
    await this.ctx.storage.put('lastTickAt', at);
    await this.ctx.storage.put('lastResult', result);

    if (result.status === 'published') {
      const published = await this.ctx.storage.get('publishedCount');
      await this.ctx.storage.put('publishedCount', (Number.isSafeInteger(published) ? published : 0) + 1);
    }

    const history = (await this.ctx.storage.get('history')) ?? [];
    history.push({ at, status: result.status, reason: result.reason ?? null, canSwap: result.canSwap ?? null });
    await this.ctx.storage.put('history', history.slice(-HISTORY_LIMIT));

    return { at, ...result };
  }

  async alarm() {
    await this.tick();
  }
}
