import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const page = await read('../components/proof/proof-page.tsx');
const check = await read('../components/proof/exit-check.tsx');
const route = await read('../app/proof/page.tsx');
const lib = await read('../lib/hook-flags.ts');
const css = await read('../components/proof/proof.css');
const proof = JSON.parse(await read('../content/exit-proof.json'));

test('/proof is a route with its own metadata and canonical url', () => {
  assert.match(route, /export const metadata/);
  assert.match(route, /canonical: "\/proof\/"/);
  assert.match(route, /<ProofPage \/>/);
});

test('the page states the claim and its limits, and does not overclaim', () => {
  assert.match(page, /When can you withdraw from a BELL pool\? <em>Always\.<\/em>/);
  assert.match(page, /no BELL policy can hold a withdraw back/i);
  assert.match(page, /Uniswap v4 PositionManager and PoolManager/);
  assert.match(page, /Only exits are guaranteed/);
  assert.match(page, /independent security audit is not complete/i);
  assert.match(page, /not written yet/i, 'the missing invariant test is stated, not implied');
  assert.doesNotMatch(page, /guarantee(s|d)? (that )?(you|your funds)/i);
});

test('the browser check and the script share one piece of arithmetic', async () => {
  assert.match(check, /from "@\/lib\/hook-flags"/);
  const script = await read('../../../scripts/verify-exit-liveness.ts');
  assert.match(script, /from "\.\.\/apps\/web\/lib\/hook-flags\.ts"/);
  assert.match(lib, /0x3fffn/);
  assert.match(lib, /0x2cc0/);
  for (const bit of ['beforeRemoveLiquidity', 'afterRemoveLiquidity', 'afterRemoveLiquidityReturnDelta']) {
    assert.match(lib, new RegExp(`name: "${bit}", exit: true`));
  }
});

test('the receipts list is the data file, and a DONE row carries a transaction', () => {
  assert.match(page, /from "@\/content\/exit-proof\.json"/);
  for (const r of proof.receipts) {
    if (r.status === 'DONE') assert.match(r.tx, /^0x[0-9a-f]{64}$/);
    else assert.equal(r.tx, null);
  }
  assert.ok(proof.receipts.length >= 6);
});

test('the live table falls back to the committed list and says which one it shows', () => {
  assert.match(check, /KEEPER_URL/);
  assert.match(check, /could not be reached/);
  assert.match(check, /Showing the list committed to the repo/);
});

test('the page uses the landing bar and contains no dots or diamonds', () => {
  assert.match(page, /<LandingNav appName="BELL" sections=\{LANDING_SECTIONS\} base="\/" \/>/);
  assert.doesNotMatch(css, /rotate\(45deg\)|border-radius:\s*50%/);
  for (const src of [page, check]) {
    assert.ok(!src.includes('·'));
    assert.doesNotMatch(src, /<circle/);
  }
});

test('the other pages point at /proof', async () => {
  assert.match(await read('../components/v4/v4-page.tsx'), /Exit Liveness Proof at \/proof/);
  assert.match(await read('../components/landing/gyevo/final-reveal.tsx'), /href="\/proof"/);
  const protocol = await read('../app/(app)/protocol/page.tsx');
  assert.match(protocol, /0x2CC0 sets five/);
  assert.match(protocol, /href="\/proof"/);
});
