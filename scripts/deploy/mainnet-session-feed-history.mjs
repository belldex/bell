#!/usr/bin/env node
/** Read recent Robinhood Chain Chainlink rounds and estimate 120s freshness windows by ET session. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi } from 'viem';
import { loadEnvFile } from './env-loader.mjs';

const CHAIN_ID = 4663;
const SAMPLE_ROUNDS = 100;
const OUTPUT = 'evidence/deploy/mainnet-4663-session-feed-history.json';
const envPath = process.env.BELL_ENV_FILE || '.env';
const env = loadEnvFile({ filePath: envPath });
const rpc = env.RH_MAINNET_RPC_PRIMARY;
if (!rpc) throw new Error('RH_MAINNET_RPC_PRIMARY is required');
const evidencePath = 'evidence/deploy/mainnet-4663-chainlink-session-adapters.json';
if (!existsSync(evidencePath)) throw new Error(`missing deployed feed evidence: ${evidencePath}`);
const adapterEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
if (Number(adapterEvidence.chainId) !== CHAIN_ID) throw new Error('feed evidence is not Robinhood Chain Mainnet');

const client = createPublicClient({ transport: http(rpc) });
const chainId = await client.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`RPC chainId is ${chainId}, expected ${CHAIN_ID}`);
const block = await client.getBlock();
const feedAbi = parseAbi([
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)',
]);
const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const ET_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
const OVERNIGHT_OPEN_DAYS = new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu']);

function etParts(timestamp) {
  return Object.fromEntries(etFormatter.formatToParts(new Date(timestamp * 1000)).map(({ type, value }) => [type, value]));
}

function classify(timestamp) {
  const p = etParts(timestamp);
  const minute = Number(p.hour) * 60 + Number(p.minute);
  const weekday = p.weekday;
  const date = `${p.year}-${p.month}-${p.day}`;
  if (minute >= 1200 && OVERNIGHT_OPEN_DAYS.has(weekday)) return { session: 'OVERNIGHT', sessionDate: date };
  if (minute < 240 && ET_DAYS.has(weekday)) {
    const priorDate = new Date(`${date}T00:00:00Z`);
    priorDate.setUTCDate(priorDate.getUTCDate() - 1);
    return { session: 'OVERNIGHT', sessionDate: priorDate.toISOString().slice(0, 10) };
  }
  if (!ET_DAYS.has(weekday)) return null;
  if (minute >= 240 && minute < 570) return { session: 'PRE', sessionDate: date };
  if (minute >= 570 && minute < 960) return { session: 'REGULAR', sessionDate: date };
  if (minute >= 960 && minute < 1200) return { session: 'POST', sessionDate: date };
  return null;
}

function summarizeSession(rounds) {
  const groups = new Map();
  for (const timestamp of rounds) {
    const session = classify(timestamp);
    if (!session) continue;
    const key = `${session.sessionDate}:${session.session}`;
    if (!groups.has(key)) groups.set(key, { ...session, timestamps: [] });
    groups.get(key).timestamps.push(timestamp);
  }

  const rows = [...groups.values()].map((group) => {
    const times = group.timestamps.sort((a, b) => a - b);
    const gaps = times.slice(1).map((time, i) => time - times[i]);
    const coveredSeconds = gaps.reduce((sum, gap) => sum + Math.min(gap, 120), 0);
    const observedSeconds = gaps.reduce((sum, gap) => sum + gap, 0);
    return {
      date: group.sessionDate,
      session: group.session,
      rounds: times.length,
      intervalsBetweenRounds: gaps.length,
      intervalsWithin120Seconds: gaps.filter((gap) => gap < 120).length,
      longestGapSeconds: gaps.length ? Math.max(...gaps) : null,
      estimatedFreshWindowCoveragePct: observedSeconds ? Number((coveredSeconds * 100 / observedSeconds).toFixed(2)) : null,
      latestRoundAt: times.at(-1) ?? null,
      firstRoundET: times.length ? etFormatter.format(new Date(times[0] * 1000)) : null,
      latestRoundET: times.length ? etFormatter.format(new Date(times.at(-1) * 1000)) : null,
    };
  });

  const totals = {};
  for (const session of ['PRE', 'REGULAR', 'POST', 'OVERNIGHT']) {
    const items = rows.filter((row) => row.session === session);
    const gaps = items.flatMap((row) => {
      const group = groups.get(`${row.date}:${session}`);
      return group.timestamps.slice(1).map((time, i) => time - group.timestamps[i]);
    });
    const coverageNumerator = gaps.reduce((sum, gap) => sum + Math.min(gap, 120), 0);
    const coverageDenominator = gaps.reduce((sum, gap) => sum + gap, 0);
    totals[session] = {
      rounds: items.reduce((sum, item) => sum + item.rounds, 0),
      sessionDays: items.length,
      intervalsBetweenRounds: gaps.length,
      intervalsWithin120Seconds: gaps.filter((gap) => gap < 120).length,
      longestWithinSessionGapSeconds: gaps.length ? Math.max(...gaps) : null,
      estimatedFreshWindowCoveragePct: coverageDenominator
        ? Number((coverageNumerator * 100 / coverageDenominator).toFixed(2)) : null,
      latestRoundET: items.reduce((latest, item) => item.latestRoundAt > (latest?.latestRoundAt ?? 0) ? item : latest, null)?.latestRoundET ?? null,
    };
  }
  return { sessions: totals, observedSessionDays: rows };
}

const assets = {};
for (const [symbol, asset] of Object.entries(adapterEvidence.assets)) {
  const latest = await client.readContract({ address: asset.feed, abi: feedAbi, functionName: 'latestRoundData', blockNumber: block.number });
  const roundId = latest[0];
  const candidates = Array.from({ length: SAMPLE_ROUNDS }, (_, index) => roundId - BigInt(index)).filter((id) => id > 0n);
  const results = await Promise.all(candidates.map((id) => client.readContract({
    address: asset.feed, abi: feedAbi, functionName: 'getRoundData', args: [id], blockNumber: block.number,
  }).catch(() => null)));
  const rounds = results.filter((round) => round && round[1] > 0n && round[3] > 0n).map((round) => Number(round[3]));
  const summarized = summarizeSession(rounds);
  const age = Number(block.timestamp - latest[3]);
  assets[symbol] = {
    feed: asset.feed,
    latestRoundId: roundId.toString(),
    latestUpdatedAt: Number(latest[3]),
    latestAgeSeconds: age,
    samplesRequested: candidates.length,
    validRoundsSampled: rounds.length,
    allSessionsObserved: Object.values(summarized.sessions).every((session) => session.rounds > 0),
    ...summarized,
  };
}

const report = {
  chainId,
  sampledAt: new Date(Number(block.timestamp) * 1000).toISOString(),
  blockNumber: Number(block.number),
  source: 'Robinhood Chain onchain Chainlink AggregatorV3 historical rounds',
  freshnessLimitSeconds: 120,
  note: 'Coverage is estimated only between adjacent sampled rounds in the same ET session-date; it excludes time before the first and after the last sample in each group.',
  assets,
};

if (process.argv.includes('--write')) {
  writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    written: OUTPUT,
    sampledAt: report.sampledAt,
    blockNumber: report.blockNumber,
    freshnessLimitSeconds: report.freshnessLimitSeconds,
    assets: Object.fromEntries(Object.entries(assets).map(([symbol, asset]) => [symbol, {
      latestAgeSeconds: asset.latestAgeSeconds,
      validRoundsSampled: asset.validRoundsSampled,
      sessions: Object.fromEntries(Object.entries(asset.sessions).map(([session, summary]) => [session, {
        rounds: summary.rounds,
        sessionDays: summary.sessionDays,
        intervalsWithin120Seconds: summary.intervalsWithin120Seconds,
        estimatedFreshWindowCoveragePct: summary.estimatedFreshWindowCoveragePct,
      }])),
    }])),
  }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}
