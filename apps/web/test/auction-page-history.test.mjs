import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../app/(app)/auction/page.tsx', import.meta.url), 'utf8');

test('auction history distinguishes final clearing from a still-indicative cycle', () => {
  assert.match(page, /cycleFinalized/);
  assert.match(page, /Final clearing/);
  assert.match(page, /Indicative clearing/);
});

test('an expired but unfinalized cycle is shown as refund available, not refunded', () => {
  assert.match(page, /Refund available/);
  assert.match(page, /finalized/);
});

test('the armed countdown uses the auction lead read from the contract', () => {
  assert.match(page, /openTime\s*-\s*now\s*-\s*auctionLead/);
  assert.doesNotMatch(page, /openTime\s*-\s*now\s*-\s*600/);
});

test('auction disclosure does not promise that matching orders reprice the AMM', () => {
  assert.match(page, /One-sided or unmatched orders are refunded/);
  assert.match(page, /AMM price itself is unchanged/);
  assert.doesNotMatch(page, /cannot take the whole gap/);
});

test('auction snapshots and history use the Worker read API instead of browser RPC calls', () => {
  assert.match(page, /fetchAuctionFeed\(/);
  assert.match(page, /fetchAuctionCycle\(/);
  assert.doesNotMatch(page, /createPublicClient\(|http\(RPC\)/);
});

test('network read errors stay concise and actionable', () => {
  assert.doesNotMatch(page, /request body:|Raw Call Arguments|Contract Call:/i);
  assert.match(page, /auctionReadError/);
});

test('auction state is read through the keeper feed so a blocked browser RPC cannot break the page', async () => {
  const feed = await readFile(new URL('../lib/auction-feed.ts', import.meta.url), 'utf8');
  assert.match(feed, /\/auctions/);
  assert.match(feed, /fetchAuctionFeed/);
  assert.match(page, /fetchAuctionFeed/);
  assert.match(page, /fetchAuctionCycle/);
});
