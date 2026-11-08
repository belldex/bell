#!/usr/bin/env node
/**
 * Summarise research/replay/results.csv for the /proof page: writes apps/web/content/lp-proof.json and copies the two charts into
 * apps/web/public/proof/. Every figure on the page comes from this file, and this file only from results.csv.
 *
 *   node research/replay/make-summary.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const root = new URL('../../', import.meta.url);
const [head, ...lines] = readFileSync(new URL('results.csv', here), 'utf8').trim().split('\n');
const cols = head.split(',');
const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
const n = (k) => rows.map((r) => Number(r[k]));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const EPS = 1e-4; // a dollar difference under one hundredth of a cent is a tie

const inputs = JSON.parse(readFileSync(new URL('data/weekends.json', here), 'utf8'));
const weekends = [...new Set(rows.map((r) => r.friday))].sort();
const better = rows.filter((r) => Number(r.difference_usd) > EPS).length;
const worse = rows.filter((r) => Number(r.difference_usd) < -EPS).length;
const meanA = (sum(n('lp_net_a_pct')) / rows.length) * 100; // percent to basis points
const meanB = (sum(n('lp_net_b_pct')) / rows.length) * 100;
const bigGap = rows.filter((r) => Math.abs(Number(r.gap_bps)) >= 100);
const smallGap = rows.filter((r) => Math.abs(Number(r.gap_bps)) < 100);
const mean = (rs, k) => (rs.length ? (sum(rs.map((r) => Number(r[k]))) / rs.length) * 100 : 0);

const out = {
  generatedFrom: 'research/replay/results.csv',
  priceSource: inputs.source,
  pricesFetchedAt: inputs.fetchedAt,
  weekends: weekends.length,
  firstFriday: weekends[0],
  lastFriday: weekends[weekends.length - 1],
  rows: rows.length,
  capitalUsd: 100000,
  better, worse, tie: rows.length - better - worse,
  meanLpNetBpStandard: Number(meanA.toFixed(2)),
  meanLpNetBpBell: Number(meanB.toFixed(2)),
  totalDifferenceUsd: Number(sum(n('difference_usd')).toFixed(2)),
  largestLossBpStandard: Number((Math.min(...n('lp_net_a_pct')) * 100).toFixed(2)),
  largestLossBpBell: Number((Math.min(...n('lp_net_b_pct')) * 100).toFixed(2)),
  bigGap: { rows: bigGap.length, meanBpStandard: Number(mean(bigGap, 'lp_net_a_pct').toFixed(2)), meanBpBell: Number(mean(bigGap, 'lp_net_b_pct').toFixed(2)) },
  smallGap: { rows: smallGap.length, meanBpStandard: Number(mean(smallGap, 'lp_net_a_pct').toFixed(2)), meanBpBell: Number(mean(smallGap, 'lp_net_b_pct').toFixed(2)) },
  auctionSettled: rows.filter((r) => r.auction_settled === '1').length,
  auctionMeanMatchedUsd: Math.round(sum(n('auction_matched_usd')) / rows.length),
};
mkdirSync(new URL('apps/web/public/proof/', root), { recursive: true });
writeFileSync(new URL('apps/web/content/lp-proof.json', root), JSON.stringify(out, null, 2) + '\n');
for (const f of ['chart-lp-net-by-weekend.png', 'chart-gap-vs-difference.png']) copyFileSync(new URL(f, here), new URL(`apps/web/public/proof/${f}`, root));
console.log(JSON.stringify(out, null, 2));
