#!/usr/bin/env node
/**
 * Health check for the live ANT pool and everything that keeps it alive. Reads chain state and the Worker, prints one line per check, and
 * exits 1 if any check is a problem. The `ant-health` workflow runs it every 30 minutes and keeps one GitHub issue open while anything is wrong.
 *
 *   node scripts/einstein/ant-health.mjs [--rpc <url>]
 *
 * No keys: it only reads. Thresholds are deliberately conservative so an alert comes days before something stops.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi, formatEther, formatUnits } from 'viem';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const rpc = arg('rpc', process.env.RH_MAINNET_RPC_PRIMARY || 'https://rpc.mainnet.chain.robinhood.com');
const pc = createPublicClient({ transport: http(rpc) });
const pool = JSON.parse(readFileSync('evidence/einstein/ant-pool-1795488954977.json', 'utf8'));
const ant = JSON.parse(readFileSync('evidence/deploy/mainnet-4663-ant.json', 'utf8'));
const halt = JSON.parse(readFileSync('evidence/deploy/halt-stack-4663.json', 'utf8'));
const cal = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet-calendar-state-ANT.json', 'utf8'));
const WORKER = 'https://bell-keeper-b.asysyifaq25.workers.dev';
const WORKER_WALLET = '0x14B71d1BA5dE1e718B1f1e05c8ec0333FE1d0079';
const PROVER = '0xEf4ae5048CDF3c2251Bd7250d73E1D5830E21F33';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const now = Number((await pc.getBlock()).timestamp);
const rows = [];
const check = (name, ok, note) => { rows.push({ name, ok, note }); console.log(`${ok ? 'OK     ' : 'PROBLEM'} ${name}: ${note}`); };

// Gas wallets
const wEth = await pc.getBalance({ address: WORKER_WALLET });
check('Worker gas wallet', wEth >= 150_000_000_000_000n, `${formatEther(wEth)} ETH (alert below 0.00015; it pays the keeper's reports, checkpoints and calendar activations; send ETH to ${WORKER_WALLET})`);
const pEth = await pc.getBalance({ address: PROVER });
const pUsdg = await pc.readContract({ address: USDG, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [PROVER] });
check('Prover wallet (session swaps)', pEth >= 40_000_000_000_000n && pUsdg >= 40_000n, `${formatEther(pEth)} ETH, ${formatUnits(pUsdg, 6)} USDG (alert below 0.00004 ETH or 0.04 USDG; ${PROVER})`);

const dEth = await pc.getBalance({ address: '0x6C3659988bd5f9E94F927B3FD7d0Ee3746f8d399' });
check('Governance gas wallet', dEth >= 300_000_000_000_000n, `${formatEther(dEth)} ETH (alert below 0.0003; it pays the calendar-autorenew and delegate-renew transactions; send ETH to 0x6C3659988bd5f9E94F927B3FD7d0Ee3746f8d399)`);

// Delegate: the Worker signs price reports with it, and it lasts at most 25 hours
const ADAPTER = parseAbi(['function delegateUntil() view returns (uint64)']);
const left = await Promise.all(Object.values(ant.adapters).map((a) => pc.readContract({ address: a, abi: ADAPTER, functionName: 'delegateUntil' }).then((u) => Number(u) - now)));
const minLeft = Math.min(...left);
check('Price delegate', minLeft > 3 * 3600, `${(minLeft / 3600).toFixed(1)} hours left on the shortest adapter (the ant-delegate-renew workflow renews under 6 hours; alert under 3)`);

// Calendar
const CAL = parseAbi(['function currentInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']);
const cur = await pc.readContract({ address: cal.calendarRegistry, abi: CAL, functionName: 'currentInterval', args: [ant.admittedDescriptorId] });
check('Calendar interval', Number(cur.phase) !== 0 || now - Number(cur.end) < 600, Number(cur.phase) ? `phase ${cur.phase} active until ${new Date(Number(cur.end) * 1000).toISOString()}` : `no interval active; the previous one ended ${now - Number(cur.end)} s ago (the Worker activates the next within a minute)`);
const nextRootQueued = Number(cal.coverageStart) > now; // the autorenew workflow overwrites the state with the next root once it is queued
const daysToEnd = (cal.coverageEnd - now) / 86400;
check('Calendar root', nextRootQueued || daysToEnd > 21, nextRootQueued ? `the next root is queued, starting ${new Date(cal.coverageStart * 1000).toISOString().slice(0, 10)}` : `${daysToEnd.toFixed(0)} days of coverage left, to ${new Date(cal.coverageEnd * 1000).toISOString().slice(0, 10)} (alert under 21 with no next root queued: the calendar-autorenew workflow should have queued it at 30)`);

// Pool and halt registry
const HOOK = parseAbi([
  'function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
  'function state() view returns ((uint8 lifecycle,uint8 mode,bool closedLatched,uint64 closureNonce,uint64 bellStart,uint64 corporateUntil,uint64 reopenCandidateAt,uint64 oldValidUntil,uint64[2] reopenBaseObservations,uint64[2] lastOpenObservations))',
]);
const REG = parseAbi(['function phase(bytes32) view returns (uint8)']);
const [policy, st, phase] = await Promise.all([
  pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'getPolicy' }),
  pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'state' }),
  pc.readContract({ address: halt.contracts.haltRegistry, abi: REG, functionName: 'phase', args: [ant.admittedDescriptorId] }),
]);
const MODE = ['HALTED', 'ACTIVE', 'CLOSED', 'RECOVERING', 'SETUP'];
const haltedByRegistry = Number(phase) !== 0;
const stuckRecovering = policy.mode === 3 && st.reopenCandidateAt > 0n && now - Number(st.reopenCandidateAt) > 900;
const hardHalted = policy.mode === 0 && !haltedByRegistry && Number(cur.phase) >= 1 && Number(cur.phase) <= 4;
check('Pool state', !stuckRecovering && !hardHalted, `${MODE[policy.mode]}, canSwap ${policy.canSwap}, halt registry ${['NORMAL', 'HALTED', 'RESUME_AUCTION'][phase]}${stuckRecovering ? ', recovering for over 15 minutes: the Worker keeper is not completing the reopening' : ''}${hardHalted ? ', HALTED in an open session with no registry halt: a price report or the calendar is missing' : ''}`);

// Worker endpoints
try {
  const r = await fetch(`${WORKER}/pools`); const body = await r.json();
  const row = (body.pools ?? []).find((p) => p.poolId?.toLowerCase() === pool.poolId.toLowerCase());
  check('Worker pool directory', r.ok && Boolean(row), r.ok ? (row ? `lists the ANT pool, funded ${row.funded}` : 'the ANT pool is missing from the directory') : `HTTP ${r.status}`);
} catch (e) { check('Worker pool directory', false, `unreachable: ${String(e.message).slice(0, 80)}`); }
try {
  const r = await fetch(`${WORKER}/ant-update`); const body = await r.json().catch(() => ({}));
  const sessionOpen = Number(cur.phase) >= 1 && Number(cur.phase) <= 4;
  check('Worker price update', r.ok || !sessionOpen, r.ok ? `signs a report at ${body.price} USD` : sessionOpen ? `HTTP ${r.status}: ${body.error ?? 'no body'}` : `refuses in a closed session, as designed (${body.error ?? r.status})`);
} catch (e) { check('Worker price update', false, `unreachable: ${String(e.message).slice(0, 80)}`); }

const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} OK, ${bad.length} PROBLEM`);
if (process.env.GITHUB_OUTPUT) { const { appendFileSync } = await import('node:fs'); appendFileSync(process.env.GITHUB_OUTPUT, `problems=${bad.length}\n`); }
process.exit(bad.length ? 1 : 0);
