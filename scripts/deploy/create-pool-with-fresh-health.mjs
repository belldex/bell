import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// create-testnet-pool.mjs needs a fresh health reading, but health expires in ~120s and the pool
// creation itself has a 60-second healthy-since requirement. Running them as separate processes
// keeps missing the window, so this driver chains them tightly and retries the creation once
// with a fresh health refresh if the first attempt is rejected for staleness.

function run(script, args = []) {
  console.log(`\n>>> node ${script} ${args.join(' ')}`);
  try {
    const out = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 });
    console.log(out.trim().split('\n').slice(-10).join('\n'));
    return { ok: true, out };
  } catch (error) {
    const out = String(error.stdout ?? '') + String(error.stderr ?? '');
    console.log(out.trim().split('\n').slice(-14).join('\n'));
    return { ok: false, out };
  }
}

// 1. calendar + price + health (fresh)
const cal = run('scripts/deploy/setup-calendar-and-price.mjs');
if (!cal.ok) { console.log('\n>>> FAILED at calendar/health'); process.exit(1); }

// 2. pool creation, retried once with a fresh quote if the first is rejected for staleness
let pool = run('scripts/deploy/create-testnet-pool.mjs');
if (!pool.ok && /stale|Replay|expired/i.test(pool.out)) {
  console.log('\n>>> health went stale mid-run; refreshing once and retrying');
  const refresh = run('scripts/deploy/refresh-stock-health.mjs');
  if (!refresh.ok) { console.log('\n>>> FAILED at health refresh'); process.exit(1); }
  pool = run('scripts/deploy/create-testnet-pool.mjs');
}

if (!pool.ok) {
  console.log('\n>>> FAILED at pool creation after retry');
  process.exit(1);
}
console.log('\n>>> POOL CREATED AND SEEDED ON THE NEW DEPLOYMENT <<<');
