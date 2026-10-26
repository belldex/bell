// Chainlink Data Streams report probe (M01-03).
// Pemakaian: node scripts/discovery/chainlink-report-probe.mjs <feedId> [endpoint]
// Cred dari .env: CHAINLINK_SOURCE_CREDENTIAL_A=<username>:<secret>
import { createClient, decodeReport } from '@chainlink/data-streams-sdk';
import { readFileSync } from 'node:fs';
import { selectChainlinkCredential } from './chainlink-credential.mjs';
const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const envMap = Object.fromEntries(env.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, '')]] : [];
}));
const feedId = process.argv[2];
const endpoint = process.argv[3] ?? 'https://api.dataengine.chain.link';
const wsEndpoint = endpoint.replace('https://', 'wss://').replace('api.', 'ws.');
if (!feedId) { console.error('feedId wajib'); process.exit(1); }
let credentials;
try {
  credentials = selectChainlinkCredential(envMap, endpoint);
} catch (e) {
  console.error('CREDENTIAL CONFIG FAIL:', e.message);
  process.exit(1);
}
const client = createClient({ apiKey: credentials.username, userSecret: credentials.secret, endpoint, wsEndpoint });
try {
  const r = await client.getLatestReport(feedId);
  console.log('REPORT OK — feedId:', r.feedID ?? feedId);
  try { console.log('DECODED:', JSON.stringify(decodeReport(r.fullReport ?? r.report, feedId)).slice(0, 500)); }
  catch { console.log('raw keys:', Object.keys(r).join(',')); }
} catch (e) {
  console.error('REPORT FAIL:', e.name, '-', String(e.message).slice(0, 300));
  process.exit(2);
}
