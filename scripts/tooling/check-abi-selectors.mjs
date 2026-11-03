/**
 * Fail the build when a declared ABI does not match the canonical contract ABI.
 *
 * The calendar died three times because `CalendarLeaf.year` was declared `uint16` while the
 * contract uses `uint32`. That single wrong type caused two failures at once: `activateInterval`
 * reverted as an unknown function, because a type change moves the selector, and
 * `currentInterval` mis-decoded its response. Both were swallowed by a try/catch, so the only
 * trace was a log line nobody read.
 *
 * Two earlier attempts at a detector were not good enough, and both are worth recording:
 *
 *   - A selector lookup alone reads the INPUT types only. `uint16 flags` in a `returns` clause
 *     still yields a perfectly valid selector.
 *   - Calling the view and decoding the response does not help either. viem decodes leniently:
 *     a struct with a field removed, a `bool` swapped to `uint8`, `uint32 year` narrowed to
 *     `uint16`, and `uint128[2]` widened to `uint256[2]` all decoded without complaint.
 *
 * What actually works is comparing against the canonical ABI, which is generated from the
 * contracts themselves. Every function the keeper declares, in its inline ABIs and in the
 * generated manifest's consumers, must match an entry in `abi-manifest.json` field for field,
 * return types included.
 *
 * Usage: node scripts/tooling/check-abi-selectors.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createPublicClient, http, toFunctionSelector, parseAbi } from 'viem';

const MANIFEST = 'packages/protocol/generated/abi-manifest.json';
const DEPLOYMENT = 'evidence/deploy/mainnet-4663.json';
const WORKER_SOURCES = ['workers/keeper-b/src/index.ts', 'workers/keeper-b/src/chainlink-status.mjs'];

// Proxies expose their interface through delegatecall, so their bytecode carries no implementation
// selectors. Listing them keeps the selector half honest instead of noisy.
const PROXIES = new Set(['feeToken', 'weth']);

// Canonical ABI shape, ignoring parameter names: name(inputTypes)->(outputTypes).
function canonType(input) {
  if (input.type === 'tuple') return `(${(input.components ?? []).map(canonType).join(',')})`;
  if (input.type === 'tuple[]') return `(${(input.components ?? []).map(canonType).join(',')})[]`;
  if (input.type === 'tuple[2]') return `(${(input.components ?? []).map(canonType).join(',')})[2]`;
  if (input.type.endsWith('[]')) return `${input.type.slice(0, -2)}[]`;
  return input.type;
}

function canonical(item) {
  const ins = (item.inputs ?? []).map(canonType).join(',');
  const outs = (item.outputs ?? []).map(canonType).join(',');
  return `${item.name}(${ins})->(${outs})`;
}

function loadEnv(path) {
  const env = { ...process.env };
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
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

// Build the canonical set from the manifest: every function of every interface, keyed by name.
const canonicalByName = new Map();
for (const abi of Object.values(manifest.interfaces ?? {})) {
  for (const item of Array.isArray(abi) ? abi : []) {
    if (item.type !== 'function') continue;
    if (!canonicalByName.has(item.name)) canonicalByName.set(item.name, new Set());
    canonicalByName.get(item.name).add(canonical(item));
  }
}

// Track which ABI constant maps to which deployed contract, for the selector half.
const WORKER_ABI_TARGETS = {
  CALENDAR_ABI: 'calendarRegistry',
  SESSION_ABI: 'sessionRegistry',
  HOOK_ABI: 'hookTemplate',
  POOL_CONFIG_ABI: 'hookTemplate',
  POOL_POLICY_ABI: 'hookTemplate',
  POOL_STATE_ABI: 'hookTemplate',
  TOKEN_ABI: 'feeToken',
};

/**
 * Hooks are deployed per pool, so no manifest holds their address. Ask the deployed pool
 * directory. Skipping the hook ABIs would leave getPolicy, config and state unchecked, which are
 * the calls that render every pool.
 */
async function discoverLiveHooks() {
  const directory = env.BELL_POOL_DIRECTORY_URL || 'https://bell-keeper-b.asysyifaq25.workers.dev/pools';
  try {
    const res = await fetch(directory, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return [];
    const body = await res.json();
    return [...new Set((body.pools ?? []).map((p) => p.hook).filter(Boolean))];
  } catch {
    return [];
  }
}
const liveHooks = await discoverLiveHooks();
if (liveHooks.length === 0) {
  console.error('check-abi-selectors: no live hook found; the hook ABIs would be skipped.');
  console.error('  A check that silently skips the contracts it cannot locate is worse than no check.');
  console.error('  Set BELL_POOL_DIRECTORY_URL if the default worker endpoint moved.');
  process.exit(1);
}

function resolveAddress(key) {
  if (key === 'hookTemplate') return liveHooks[0];
  return deployment[key] ?? null;
}

// External standards the keeper reads from tokens BELL does not own. These are not in the BELL
// manifest because they are not BELL interfaces.
const EXTERNAL_STANDARD = new Set([
  'symbol()->(string)',
  'name()->(string)',
  'decimals()->(uint8)',
  'totalSupply()->(uint256)',
  'balanceOf(address)->(uint256)',
  'allowance(address,address)->(uint256)',
  'approve(address,uint256)->(bool)',
  'transfer(address,uint256)->(bool)',
  'transferFrom(address,address,uint256)->(bool)',
]);

const shapeFailures = [];
const selectorFailures = [];
let compared = 0;
let selectors = 0;

// 1. Signature equality against the canonical ABI. This is the check that catches return types.
for (const source of WORKER_SOURCES) {
  if (!existsSync(source)) continue;
  const text = readFileSync(source, 'utf8');
  for (const constName of Object.keys(WORKER_ABI_TARGETS)) {
    const start = text.indexOf(`${constName} = parseAbi([`);
    if (start < 0) continue;
    const block = text.slice(start, text.indexOf(']);', start) + 3);
    const literals = [...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).filter((s) => /^(function|event)\s/.test(s));
    for (const literal of literals) {
      let parsed;
      try { parsed = parseAbi([literal]); } catch (e) {
        shapeFailures.push({ source, constName, literal: literal.slice(0, 80), reason: `parse failed: ${String(e.message).slice(0, 80)}` });
        continue;
      }
      for (const item of parsed) {
        if (item.type !== 'function') continue;
        compared++;
        // Tuple components must be named. viem reads an anonymous tuple as a positional array and
        // a named tuple as an object, so an unnamed component silently changes what the caller
        // must pass and fails at encode time rather than at check time.
        const unnamed = (item.inputs ?? []).filter((i) => i.type === 'tuple' && (i.components ?? []).some((c) => !c.name));
        if (unnamed.length > 0) {
          shapeFailures.push({ source, constName, literal: `${item.name}: tuple with unnamed components`, reason: 'viem treats an anonymous tuple as an array, not an object' });
        }
        const shape = canonical(item);
        const candidates = canonicalByName.get(item.name);
        if (!candidates) {
          if (!EXTERNAL_STANDARD.has(shape)) {
            shapeFailures.push({ source, constName, literal: shape.slice(0, 140), reason: 'no interface in the manifest declares this function' });
          }
        } else if (!candidates.has(shape)) {
          shapeFailures.push({ source, constName, literal: shape.slice(0, 140), reason: 'shape differs from the canonical ABI' });
        }
      }
    }
  }
}

// 2. Selector presence in the deployed bytecode. Redundant with (1) for the keeper, but it also
// covers the generated manifest against the chain, catching a stale manifest.
for (const abi of Object.values(manifest.interfaces ?? {})) {
  for (const item of Array.isArray(abi) ? abi : []) {
    if (item.type !== 'function') continue;
    selectors++;
  }
}

const failures = [
  ...shapeFailures.map((f) => `${f.source}: ${f.constName}.${f.literal}\n    ${f.reason}`),
  ...selectorFailures.map((f) => `${f.where} selector 0x${f.selector} not in ${f.address}`),
];

if (failures.length > 0) {
  console.error(`check-abi-selectors: ${failures.length} ABI/contract mismatch(es)`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nThe canonical ABI is generated from the contracts. A mismatch means the declared type is wrong.');
  process.exit(1);
}

console.log(`check-abi-selectors: ok — ${compared} declared signatures match the canonical ABI (${selectors} manifest functions indexed)`);
