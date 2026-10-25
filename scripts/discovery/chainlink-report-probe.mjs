// Chainlink Data Streams report probe (M01-03).
// Pemakaian: node scripts/discovery/chainlink-report-probe.mjs <feedId> [endpoint]
// Cred dari .env: CHAINLINK_SOURCE_CREDENTIAL_A=<username>:<secret>
import { createClient, decodeReport } from '@chainlink/data-streams-sdk';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const line = env.split('\n').find(l => l.startsWith('CHAINLINK_SOURCE_CREDENTIAL_A='));
const [apiKey, userSecret] = line.slice('CHAINLINK_SOURCE_CREDENTIAL_A='.length).trim().split(':');
const feedId = process.argv[2];
const endpoint = process.argv[3] ?? 'https://api.dataengine.chain.link';
const wsEndpoint = endpoint.replace('https://', 'wss://').replace('api.', 'ws.');
if (!feedId) { console.error('feedId wajib'); process.exit(1); }
const client = createClient({ apiKey, userSecret, endpoint, wsEndpoint });
try {
  const r = await client.getLatestReport(feedId);
  console.log('REPORT OK — feedId:', r.feedID ?? feedId);
  try { console.log('DECODED:', JSON.stringify(decodeReport(r.fullReport ?? r.report, feedId)).slice(0, 500)); }
  catch { console.log('raw keys:', Object.keys(r).join(',')); }
} catch (e) {
  console.error('REPORT FAIL:', e.name, '-', String(e.message).slice(0, 300));
  process.exit(2);
}