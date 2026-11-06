import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const section = await read('../components/landing/gyevo/auction-section.tsx');
const css = await read('../components/landing/gyevo/auction-section.css');
const page = await read('../components/landing/gyevo/landing-page.tsx');
const nav = await read('../components/landing/gyevo/landing-nav.tsx');

test('the auction section sits between the fee sessions and the deployment roadmap', () => {
  const order = ['<SessionSection />', '<AuctionSection />', '<RoadmapSection />'].map((tag) => page.indexOf(tag));
  assert.ok(order.every((i) => i >= 0), 'all three sections are rendered');
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('the landing nav can reach the auction section and tracks it while scrolling', () => {
  assert.match(nav, /id: "auction"/);
  assert.match(nav, /id: "sessions"[\s\S]*id: "auction"[\s\S]*id: "roadmap"/);
  assert.match(nav, /const ids = sections\.map/);
  assert.match(section, /id="auction"/);
});

test('the numbers on the page are the deployed contract parameters', () => {
  // auctionLead 600s, maxOrders 25, no auction fee
  assert.match(section, /\["10 min", "order window"\]/);
  assert.match(section, /\["25", "orders per cycle"\]/);
  assert.match(section, /\["0", "auction fee"\]/);
  assert.match(section, /Up to 15 minutes later/);
});

test('the drawing is labelled as an example and the copy does not overclaim', () => {
  assert.match(section, /Example book · sample orders/);
  assert.match(section, /the pool’s AMM price does not move/);
  assert.match(section, /Orders sit in the auction contract while the window is open/);
  assert.doesNotMatch(section, /guarantee|risk-free|protects LPs|eliminates/i);
});

test('the drawing is accessible and has a phone variant', () => {
  assert.match(section, /role="img"/);
  assert.match(section, /<title id=/);
  assert.match(section, /lp-auc__chart--\$\{id\}/);
  assert.match(section, /<ClearingBoard wide \/>/);
  assert.match(section, /<ClearingBoard wide=\{false\} \/>/);
  assert.match(css, /@media \(max-width:640px\)[\s\S]*lp-auc__chart--wide \{ display:none; \}/);
});

test('motion respects reduced motion and the page works without script', () => {
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  // The undrawn state is only applied once script has run (data-js), never by default.
  assert.match(css, /\.lp--bell\[data-js\] \.lp-auc__board:not\(\[data-rs="in"\]\)/);
});

test('poppy is spent on the clearing price and the bell mark only', () => {
  const poppy = css.split('\n').filter((l) => /var\(--lp-accent(-light)?\)/.test(l)).join('\n');
  for (const allowed of ['lp-auc__price', 'lp-auc__dot', 'lp-auc__ring', 'lp-auc__chip', 'lp-auc__stages li[data-bell', 'lp-auc__cap span:last-child', 'lp-auc__legend [data-k="price"]']) {
    assert.ok(poppy.includes(allowed), `${allowed} uses the accent`);
  }
  assert.doesNotMatch(poppy, /lp-auc__seg|lp-auc__facts|lp-auc__grid/);
});
