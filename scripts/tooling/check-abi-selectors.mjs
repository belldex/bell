/**
 * Fail the build when a declared ABI does not match the deployed contract.
 *
 * The calendar died three times because `CalendarLeaf.year` was declared `uint16` while the
 * contract uses `uint32`. A wrong type changes the function selector, so `activateInterval`
 * reverted as an unknown function and `currentInterval` failed to decode — and both failures were
 * swallowed by a try/catch, so the only trace was a log line nobody read.
 *
 * This check is the missing detector: every function in the generated ABI manifest, plus every
 * inline ABI declared by the keeper worker, is resolved to a selector and looked up in the
 * deployed bytecode. A missing selector means the ABI and the contract disagree, which is a
 * programming error, not a runtime condition.
 *
 * Usage: node scripts/tooling/check-abi-selectors.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createPublicClient, http, toFunctionSelector } from 'viem';

const MANIFEST = 'packages/protocol/generated/abi-manifest.json';
const DEPLOYMENT = 'evidence/deploy/mainnet-4663.json';
const WORKER = 'workers/keeper-b/src/index.ts';
const WORKER_STATUS = 'workers/keeper-b/src/chainlink-status.mjs';

// Proxies expose their interface through delegatecall, so their bytecode will not contain the
// implementation selectors. Listing them keeps the check honest instead of noisy.
const PROXIES = new Set(['feeToken', 'weth']);

function loadEnv(path) {
  const env = { ...process.env };
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

function canonType(input) {
  if (input.type === 'tuple') return `(${(input.components ?? []).map(canonType).join(',')})`;
  if (input.type === 'tuple[]') return `(${(input.components ?? []).map(canonType).join(',')})[]`;
  return input.type;
}

function selectorFor(fn) {
  const types = (fn.inputs ?? []).map(canonType);
  return toFunctionSelector(`function ${fn.name}(${types.join(',')})`).slice(2);
}

const env = loadEnv('.env');
const rpc = env.RH_MAINNET_RPC_PRIMARY || env.BELL_RPC_URL;
if (!rpc) {
  console.error('check-abi-selectors: no RPC configured; set RH_MAINNET_RPC_PRIMARY');
  process.exit(1);
}

const client = createPublicClient({ transport: http(rpc) });
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const deployment = JSON.parse(readFileSync(DEPLOYMENT, 'utf8'));

// Interface name -> deployment key holding its address.
const INTERFACE_TO_DEPLOYMENT = {
  IBellPoolFactory: 'poolFactory',
  IBellRouter: 'router',
  ICalendarRegistry: 'calendarRegistry',
  IAssetRegistry: 'assetRegistry',
  ISessionRegistry: 'sessionRegistry',
  ISafetyController: 'safetyController',
  IBellHook: 'hookTemplate',
};

// Worker constant name -> deployment key.
const WORKER_ABI_TARGETS = {
  CALENDAR_ABI: 'calendarRegistry',
  SESSION_ABI: 'sessionRegistry',
  HOOK_ABI: 'hookTemplate',
  POOL_CONFIG_ABI: 'hookTemplate',
  POOL_POLICY_ABI: 'hookTemplate',
  POOL_STATE_ABI: 'hookTemplate',
  TOKEN_ABI: 'feeToken',
};

// The hook template address is derived per pool; use the first live pool's hook when present.
function resolveAddress(key) {
  if (key === 'hookTemplate') {
    const hooks = deployment.liveHooks ?? [];
    return hooks[0] ?? null;
  }
  return deployment[key] ?? null;
}

const failures = [];
const checked = [];

async function codeOf(address) {
  const code = await client.getBytecode({ address });
  return (code ?? '0x').toLowerCase();
}

// 1. Generated manifest
for (const [iface, abi] of Object.entries(manifest.interfaces ?? {})) {
  const key = INTERFACE_TO_DEPLOYMENT[iface];
  const address = key ? resolveAddress(key) : null;
  if (!address) continue;
  const code = await codeOf(address);
  for (const fn of (Array.isArray(abi) ? abi : []).filter((e) => e.type === 'function')) {
    const sel = selectorFor(fn);
    checked.push(`${iface}.${fn.name}`);
    if (!code.includes(sel)) {
      failures.push({ where: `${iface}.${fn.name}`, selector: sel, address, source: MANIFEST });
    }
  }
}

// 2. Worker inline ABIs
for (const source of [WORKER, WORKER_STATUS]) {
  if (!existsSync(source)) continue;
  const text = readFileSync(source, 'utf8');
  for (const [constName, deployKey] of Object.entries(WORKER_ABI_TARGETS)) {
    const start = text.indexOf(`${constName} = parseAbi([`);
    if (start < 0) continue;
    const end = text.indexOf(']);', start);
    const block = text.slice(start, end + 3);
    const address = resolveAddress(deployKey);
    if (!address) continue;
    const code = await codeOf(address);
    const isProxy = PROXIES.has(deployKey);
    for (const m of block.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
      const raw = m[1];
      if (!/^function\s/.test(raw)) continue;
      const clean = raw.replace(/\s+(view|pure|payable)\b[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
      const name = clean.slice('function '.length, clean.indexOf('('));
      const args = clean.slice(clean.indexOf('('), clean.lastIndexOf(')') + 1);
      let sel;
      try { sel = toFunctionSelector(`function ${name}${args}`).slice(2); } catch { continue; }
      checked.push(`${CONST_NAME_PREFIX(source)}${constName}.${name}`);
      if (!code.includes(sel) && !isProxy) {
        failures.push({ where: `${source}: ${constName}.${name}`, selector: sel, address, source });
      }
    }
  }
}

function CONST_NAME_PREFIX(source) {
  return source.includes('chainlink-status') ? 'chainlink-status:' : '';
}

if (failures.length > 0) {
  console.error(`check-abi-selectors: ${failures.length} ABI/contract mismatch(es)`);
  for (const f of failures) {
    console.error(`  ${f.where}`);
    console.error(`    selector 0x${f.selector} not found in ${f.address}`);
    console.error(`    declared in ${f.source}`);
  }
  console.error('\nA wrong argument type changes the selector. Compare the type against the contract source.');
  process.exit(1);
}

console.log(`check-abi-selectors: ok — ${checked.length} function selectors match the deployed contracts`);
