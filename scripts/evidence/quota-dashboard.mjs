// Quota/admission dashboard (M12-05): baca live state -> dashboard JSON.
import { readFileSync, writeFileSync } from 'node:fs';
const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const ref = env.match(/SUPABASE_PROJECT_REF=(.*)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const base = `https://${ref}.supabase.co/rest/v1`;
const h = { apikey: key, Authorization: 'Bearer ' + key };
const get = async (p) => (await fetch(base + p, { headers: h })).json();
const metrics = await get('/service_metrics?select=metric_name,bucket,aggregate&order=bucket.desc&limit=10');
const quota = await get('/quota_counters?select=account_scope,period,estimated_usage&order=estimated_usage.desc&limit=10');
const cp = await get('/indexer_checkpoints?select=shard_id,last_block_number,lag_seconds&limit=5');
const leases = await get('/job_leases?select=chain_id,job_kind,fence,expires_at&limit=5');
const dashboard = {
  generatedAt: new Date().toISOString(),
  admission: { stocks: 6, pricedQuoteAssets: 8, indexedPools: 24, note: 'ceiling per brief 20.L; not a claim that capacity has been reached' },
  health: { indexLag: metrics.find(m => m.metric_name === 'index_lag_seconds')?.aggregate ?? null, keeperTicks15m: metrics.find(m => m.metric_name === 'keeper_ticks_15m')?.aggregate ?? null, apiQuota: metrics.find(m => m.metric_name === 'api_quota_used')?.aggregate ?? null },
  indexerCheckpoints: cp, activeLeases: leases,
  topQuotaConsumers: quota.map(q => ({ scope: q.account_scope.slice(0, 8) + '***', period: q.period, used: q.estimated_usage })),
  alerts: []
};
const lag = dashboard.health.indexLag?.latest ?? 0;
if (lag > (dashboard.health.indexLag?.threshold_warn ?? 120)) dashboard.alerts.push({ severity: lag > (dashboard.health.indexLag?.threshold_stop ?? 300) ? 'STOP' : 'WARN', code: 'INDEX_LAGGING', value: lag });
console.log(JSON.stringify(dashboard, null, 2).slice(0, 900));
writeFileSync(new URL('../../evidence/runtime/quota-dashboard-2026-10-25.json', import.meta.url), JSON.stringify(dashboard, null, 2));
console.log('saved evidence/runtime/quota-dashboard-2026-10-25.json');
