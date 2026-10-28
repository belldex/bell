// Live freshness trace (M01-05): staleness profile from canonical chain_blocks.
import { readFileSync, writeFileSync } from 'node:fs';
const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const ref = env.match(/SUPABASE_PROJECT_REF=(.*)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const base = `https://${ref}.supabase.co/rest/v1`;
const h = { apikey: key, Authorization: 'Bearer ' + key };
const rows = await (await fetch(base + '/chain_blocks?chain_id=eq.4663&canonical=eq.true&select=block_number,created_at&order=block_number.desc&limit=50', { headers: h })).json();
const observedAges = rows.map(r => Math.round((Date.now() - new Date(r.created_at).getTime()) / 1000));
const sorted = [...observedAges].sort((a, b) => a - b);
const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
const trace = {
  capturedAt: new Date().toISOString(), source: 'chain_blocks canonical (indexer-tick cron 59s)',
  samples: rows.length, headBlock: rows[0]?.block_number ?? null,
  observedAgeSeconds: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: sorted[sorted.length - 1] ?? null },
  guard: 'Live source freshness (Data Streams) awaits entitlement; this trace measures infrastructure ingest freshness, not prices'
};
console.log(JSON.stringify(trace, null, 2));
writeFileSync(new URL('../../evidence/runtime/freshness-trace-live-2026-10-25.json', import.meta.url), JSON.stringify(trace, null, 2));
