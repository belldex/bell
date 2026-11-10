import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('pool verification route is statically generated for validated Mainnet pool IDs', async () => {
  const route = await read('../app/(app)/pool/[poolId]/page.tsx');
  assert.match(route, /generateStaticParams/);
  assert.match(route, /poolId/);
  assert.match(route, /PoolVerificationPage/);
  assert.doesNotMatch(route, /dynamicParams\s*=\s*true|force-dynamic/);
});

test('pool details read live Lens state and receipts rather than hard-coded policy values', async () => {
  const page = await read('../components/pool/pool-verification-page.tsx');
  assert.match(page, /getSwapStatus/);
  assert.match(page, /currentFeePips/);
  assert.match(page, /auctionWindow/);
  assert.match(page, /nextTransition/);
  assert.match(page, /\/pools\/\$\{poolId\}\/receipts/);
  assert.match(page, /Blockscout|robinhoodchain\.blockscout\.com/);
  assert.match(page, /receipt\.fee/);
  assert.match(page, /unknown|unavailable|not available/i);
});

test('/verify teaches the four chain checks and links the public verifier', async () => {
  const route = await read('../app/verify/page.tsx');
  const page = await read('../components/verify/verify-page.tsx');
  assert.match(route, /canonical: ['"]\/verify\//);
  assert.match(page, /Initialize/);
  assert.match(page, /0x2CC0/i);
  assert.match(page, /500/);
  assert.match(page, /10,000/);
  assert.match(page, /TradeCapExceeded/);
  assert.match(page, /AuctionActive/);
  assert.match(page, /PolicyBlocked/);
  assert.match(page, /integrations\/verify-bell\.ts/);
  assert.match(page, /integrations\/bell-verifier\.zip/);
});

test('/integrations uses the live pool endpoint and publishes the quote-before-route contract', async () => {
  const route = await read('../app/integrations/page.tsx');
  const page = await read('../components/integrations/integrations-page.tsx');
  assert.match(route, /canonical: ['"]\/integrations\//);
  assert.match(page, /\/pools/);
  assert.match(page, /getSwapStatus/);
  assert.match(page, /reason/);
  assert.match(page, /hasAuction/);
  assert.match(page, /PLANNED|LIVE|DEPLOYED/);
  assert.match(page, /observedAt|blockNumber/);
});

test('pool directory links to each pool by poolId instead of the legacy hook query', async () => {
  const page = await read('../app/(app)/pools/page.tsx');
  assert.match(page, /\/pool\/\$\{pool\.poolId\}/);
});
