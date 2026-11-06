import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const page = await read('../components/v4/v4-page.tsx');
const config = await read('../config/mainnet.ts');
const ledger = await read('../components/v4/contracts-ledger.tsx');
const badge = await read('../components/v4/status-badge.tsx');
const route = await read('../app/v4/page.tsx');
const nav = await read('../components/landing/gyevo/landing-nav.tsx');
const progress = JSON.parse(await read('../content/build-progress.json'));

test('/v4 is a route with its own metadata and a real PNG for the open graph image', async () => {
  assert.match(route, /export const metadata/);
  assert.match(route, /canonical: "\/v4\/"/);
  // A file with an extension, so a static host serves it with the right content type.
  assert.match(route, /\/assets\/og-v4\.png/);
  const png = await readFile(new URL('../public/assets/og-v4.png', import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test('every status comes from the same small vocabulary', () => {
  for (const s of ['LIVE', 'DEPLOYED', 'IN DEVELOPMENT', 'PLANNED', 'BUILDING TOWARD']) assert.match(badge, new RegExp(`"${s}"`));
  assert.match(badge, /TO CONFIRM/);
});

test('addresses come from one config fed by the deployment record, not from literals in the page', () => {
  assert.match(config, /evidence\/deploy\/mainnet-4663\.json/);
  assert.match(config, /scripts\/auction-cli\/targets\.json/);
  assert.match(page, /from "@\/config\/mainnet"/);
  // Superseded generations must never reappear.
  const stale = ['0xf677edc6346be53686', '0x908bea5cd3C5297Ad', '0x3e5cEBb068ac71D742', '0xEBDb2291f07F10490E', '0xe5D8c6Ba18589a71a8'];
  for (const address of stale) {
    assert.ok(!page.includes(address) && !config.includes(address) && !ledger.includes(address), `${address} is a superseded address`);
  }
});

test('the status copy is true to what is deployed and does not overclaim', () => {
  assert.match(page, /BELL v4 · LIVE \+ ROADMAP/);
  assert.match(page, /no auction has settled yet/);
  assert.doesNotMatch(page, /Opening Bell Auction is in development and not live/);
  assert.doesNotMatch(page, /all contracts (are )?verified/i);
  assert.match(page, /Pool hooks are next/);
  assert.equal(progress.auctionMergedToMain, true);
  assert.ok(progress.coreContractsVerified >= 29);
});

test('the hook mask is described by the flags it actually sets', () => {
  assert.match(config, /'beforeInitialize', 'beforeAddLiquidity', 'afterAddLiquidity', 'beforeSwap', 'afterSwap'/);
  assert.doesNotMatch(config, /RemoveLiquidity/);
  assert.match(ledger, /No remove-liquidity flag/);
});

test('external contracts are labelled so they are never read as BELL contracts', () => {
  assert.match(config, /external\('Uniswap v4 PoolManager'/);
  assert.match(ledger, /not BELL/);
});

test('the share text, copy buttons, and mobile cards from the brief are present', async () => {
  assert.match(page, /BELL holds the bell\./);
  assert.match(page, /bellstocks\.tech\/v4/);
  assert.match(page, /intent\/post/);
  const copy = await read('../components/v4/copy-address.tsx');
  assert.match(copy, /navigator\.clipboard/);
  const css = await read('../components/v4/v4.css');
  assert.match(css, /@media \(max-width:860px\)[\s\S]*v4-addr-short \{ display:inline; \}/);
});

test('the landing nav links to /v4 without widening the section rail', () => {
  assert.match(nav, /href="\/v4\/"/);
});

test('no rotated squares anywhere on /v4 or in the landing auction section', async () => {
  for (const file of ['../components/v4/v4.css', '../components/landing/gyevo/auction-section.css']) {
    const css = await read(file);
    assert.doesNotMatch(css, /rotate\(45deg\)/, `${file} draws a diamond`);
  }
  const art = await read('../components/v4/art.tsx');
  assert.doesNotMatch(art, /rotate\(45/);
});

test('looping art is pure SVG and CSS, and every loop has a still frame for reduced motion', async () => {
  const css = await read('../components/v4/v4.css');
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)', css.indexOf('motion off')));
  for (const rule of ['.v4-rings__ring { animation:none; }', '.v4-marquee__track { animation:none; }', '.v4-vig__dot { animation:none;', '.v4-vig__hit { animation:none;', '.v4-bellcard::after']) {
    assert.ok(reduced.includes(rule), `reduced motion stops ${rule}`);
  }
  assert.match(page, /BellRings/);
  assert.match(page, /OrdersVignette/);
  assert.match(page, /ClearVignette/);
  assert.match(page, /v4-marquee/);
});

test('the heaviest effects are kept off animated layers', async () => {
  const css = await read('../components/v4/v4.css');
  assert.doesNotMatch(css, /mask-image/);
  assert.equal((css.match(/backdrop-filter/g) ?? []).length <= 2, true); // only the static sticky bar
});
