/**
 * Durable Object that owns the keeper schedule and its observable state.
 *
 * The alarm is persisted before any network work, so a crash mid-tick still leaves the next
 * wakeup scheduled. Every tick result (published / skipped / failed) is stored so /status can
 * explain why the keeper is not publishing instead of leaving a silent gap.
 */
import { decodeAbiParameters, parseAbiParameters } from 'viem';
import { runQuote, runTick } from './index.ts';

const ALARM_INTERVAL_MS = 90_000;
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

    if (url.pathname === '/quote') {
      const headers = { 'cache-control': 'no-store' };
      try {
        const symbol = url.searchParams.get('symbol');
        const bundle = await runQuote(this.env, symbol);
        // Revalidate the chain on every request before reusing a bundle. Serialize only the
        // cache update so concurrent callers receive the same report without reserving it.
        const [stream] = decodeAbiParameters(parseAbiParameters('(bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash),bytes'), bundle.reports[0]);
        const context = JSON.stringify([this.env.BELL_EXPECTED_CHAIN_ID, this.env.YAHOO_SOURCE_VERIFIER_ADDRESS,
          this.env.BELL_MAINNET_ASSETS, bundle.assetId, stream.phase]);
        const reusable = await this.ctx.blockConcurrencyWhile(async () => {
          const key = `quoteBundle:${symbol}`;
          const cached = await this.ctx.storage.get(key);
          if (cached?.context === context
            && cached.bundle.directSample.observedAt === bundle.directSample.observedAt
            && BigInt(cached.bundle.directSample.validUntil) > BigInt(Math.floor(Date.now() / 1000))) return cached.bundle;
          await this.ctx.storage.put(key, { context, bundle });
          return bundle;
        });
        return Response.json(reusable, { headers });
      } catch (error) {
        const detail = String(error?.shortMessage ?? error?.message ?? error)
          .replace(/https?:\/\/[^\s"'`]+/g, '[url]')
          .slice(0, 240);
        console.error('quote handler failed', error?.name ?? 'Error', detail);
        return Response.json({ error: error.status ? error.message : 'quote service unavailable' }, { status: error.status || 503, headers });
      }
    }
    if (this.env.BELL_ORACLE_MODE === 'pull' && ['/tick', '/ensure-alarm'].includes(url.pathname)) {
      await this.ctx.storage.deleteAlarm();
      return Response.json({ error: 'scheduled transactions disabled in pull mode' }, { status: 409 });
    }
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
    if (this.env.BELL_ORACLE_MODE === 'pull') {
      await this.ctx.storage.deleteAlarm();
      return null;
    }
    const desired = nextAlarmTimestamp(Date.now());
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > desired) await this.ctx.storage.setAlarm(desired);
    return await this.ctx.storage.getAlarm();
  }

  async tick() {
    if (this.env.BELL_ORACLE_MODE === 'pull') {
      await this.ctx.storage.deleteAlarm();
      return { status: 'skipped', reason: 'scheduled transactions disabled in pull mode' };
    }
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
