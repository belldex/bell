#!/usr/bin/env node
/**
 * Watches Robinhood's pricing API for a trading halt and drives the HaltRegistry through halt-reporter.mjs.
 *
 *   node scripts/einstein/halt-watcher.mjs tick  --asset ANT [--symbol ANT] [--network mainnet]
 *   node scripts/einstein/halt-watcher.mjs loop  --asset ANT --every 20 --broadcast
 *   node scripts/einstein/halt-watcher.mjs tick  --network mainnet --confirm-wait 45 --broadcast --i-authorize-spend   (one run per scheduler tick: two reads, 45 s apart)
 *
 * Default is a dry run: it reads the quote and the registry and prints the decision. With --broadcast it sends the hybrid-signed call, one
 * REPORTER leaf each. --network mainnet also needs --i-authorize-spend.
 *
 * What the source is, and is not: `isTradingHalt` is Robinhood's own flag in `GET https://api.robinhood.com/rhj/prices/<symbol>`, not the
 * exchange's halt feed, and it carries no halt start time. The watcher therefore records the time it FIRST SAW the flag as the start, so the
 * registry's `reportDelay` measures nothing about the exchange's own delay. Two consecutive observations are required before it acts, and a
 * missing, failed or stale quote never causes an action: the registry's own two hour expiry is the fail-safe.
 */
import { pathToFileURL } from 'node:url';
import { doHalt, doResume, doRenew, status } from './halt-reporter.mjs';

export const CONFIRMATIONS = 2; // consecutive observations before acting
export const MAX_QUOTE_AGE_SECONDS = 60;
export const RENEW_BEFORE_SECONDS = 15 * 60;

/**
 * Pure decision. `obs` is { halted: boolean|null, ageSeconds } from the quote (halted null when the read failed); `registry` is
 * { phase: 'NORMAL'|'HALTED'|'RESUME_AUCTION', haltedUntil }; `streak` counts consecutive observations that agree with the last one.
 * Returns { action: 'halt'|'resume'|'renew'|'none', reason }.
 */
export function decide({ obs, registry, streak, now }) {
  if (obs.halted === null || obs.ageSeconds === null || obs.ageSeconds > MAX_QUOTE_AGE_SECONDS) return { action: 'none', reason: 'no fresh quote: nothing is recorded on missing data' };
  if (obs.halted) {
    if (registry.phase === 'HALTED') {
      return registry.haltedUntil - now <= RENEW_BEFORE_SECONDS
        ? { action: 'renew', reason: `still halted and the registry expires in ${registry.haltedUntil - now} s` }
        : { action: 'none', reason: 'halted and already recorded' };
    }
    return streak >= CONFIRMATIONS
      ? { action: 'halt', reason: `the quote said halted ${streak} times in a row and the registry is ${registry.phase}` }
      : { action: 'none', reason: `halt seen ${streak} of ${CONFIRMATIONS} times` };
  }
  if (registry.phase === 'HALTED') {
    return streak >= CONFIRMATIONS
      ? { action: 'resume', reason: `the quote said trading ${streak} times in a row and the registry is HALTED` }
      : { action: 'none', reason: `resume seen ${streak} of ${CONFIRMATIONS} times` };
  }
  return { action: 'none', reason: 'trading and nothing recorded' };
}

export async function readQuote(symbol, fetchFn = fetch, now = Date.now()) {
  try {
    const r = await fetchFn(`https://api.robinhood.com/rhj/prices/${symbol}`);
    if (!r.ok) return { halted: null, ageSeconds: null, error: `HTTP ${r.status}` };
    const q = (await r.json()).quotes?.[0];
    if (!q || typeof q.isTradingHalt !== 'boolean' || !q.generatedAt) return { halted: null, ageSeconds: null, error: 'no usable quote' };
    return { halted: q.isTradingHalt, ageSeconds: Math.max(0, Math.round((now - Date.parse(q.generatedAt)) / 1000)), generatedAt: q.generatedAt };
  } catch (e) { return { halted: null, ageSeconds: null, error: String(e.message ?? e) }; }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readFileSync } = await import('node:fs');
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const command = process.argv[2] ?? 'tick';
  const broadcast = process.argv.includes('--broadcast');
  const MAINNET = arg('network', 'testnet') === 'mainnet';
  const state = JSON.parse(readFileSync(arg('state', MAINNET ? 'evidence/deploy/mainnet-4663-ant.json' : 'evidence/deploy/testnet-46630-ant-delegated.json'), 'utf8'));
  const asset = state.admittedDescriptorId; const symbol = arg('symbol', 'ANT');
  let last = null; let streak = 0;
  const confirmWait = Number(arg('confirm-wait', '0'));
  const tick = async () => {
    let obs = await readQuote(symbol);
    let key = obs.halted === null ? 'null' : String(obs.halted);
    streak = key === last ? streak + 1 : 1; last = key;
    if (confirmWait > 0) {
      // One run per scheduler tick (a CI cron keeps no memory between runs): read twice, confirmWait seconds apart, and act only if both agree.
      await new Promise((r) => setTimeout(r, confirmWait * 1000));
      const again = await readQuote(symbol);
      const key2 = again.halted === null ? 'null' : String(again.halted);
      obs = again; streak = key2 === key ? CONFIRMATIONS : 1; last = key2; key = key2;
    }
    const reg = await status(asset);
    const now = Math.floor(Date.now() / 1000);
    const d = decide({ obs, registry: reg, streak, now });
    console.log(`${new Date().toISOString()} quote ${obs.halted === null ? `unavailable (${obs.error})` : `isTradingHalt=${obs.halted} age ${obs.ageSeconds}s`}, registry ${reg.phase}, streak ${streak} -> ${d.action}: ${d.reason}`);
    if (!broadcast || d.action === 'none') return d;
    const r = d.action === 'halt' ? await doHalt(asset, BigInt(now), 'ROBINHOOD_HALT_FLAG') : d.action === 'resume' ? await doResume(asset, BigInt(now)) : await doRenew(asset);
    console.log(`  ${d.action} sent: ${r.tx} (leaf ${r.leaf})`);
    return d;
  };
  if (command === 'tick') await tick();
  else if (command === 'loop') { for (;;) { try { await tick(); } catch (e) { console.log(`  tick failed: ${String(e.shortMessage ?? e.message).split('\n')[0]}`); } await new Promise((r) => setTimeout(r, Number(arg('every', '20')) * 1000)); } }
  else throw new Error('usage: halt-watcher.mjs tick|loop --asset ANT');
}
