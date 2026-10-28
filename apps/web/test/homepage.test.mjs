import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const homepage = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const template = await readFile(new URL('../public/templates/v4market/index.html', import.meta.url), 'utf8');
const scene = await readFile(new URL('../public/templates/v4market/_next/static/immutable/chunks/1vlv6u7q63-kz.js', import.meta.url), 'utf8');

test('the landing page delegates to the pinned v4market template document', () => {
  // The marketing page is a downloaded static document loaded as the document itself, because its
  // Three.js module owns a document-level canvas. Assert the redirect target instead of asserting
  // markup that no longer lives in React.
  assert.match(homepage, /window\.location\.replace\('\/templates\/v4market\/index\.html'\)/);
});

test('the served template keeps the exact scene and adapts visible homepage copy for BELL', () => {
  assert.match(template, /<div class="scene" aria-hidden="true"><\/div>/);
  assert.match(template, /class="story hero" data-pose="0"/);
  assert.match(template, /data-pose="8"/);
  assert.match(scene, /new t0\(l,h,220\)/);
  assert.match(scene, /getBoundingClientRect\(\)\.top<=i/);
  assert.match(template, /<title>BELL — Liquidity that knows the bell<\/title>/);
  assert.ok(template.includes(String.raw`\"words\":[\"Liquidity\",\"that knows\",\"the\",\"bell\"]`));
  assert.match(template, /Liquidity that knows the bell/);
  assert.match(template, /BELL applies session-aware fees, bounded gross flow and planned-close controls/);
  assert.doesNotMatch(template, /The marketplace for Uniswap v4 hooks/);
  assert.doesNotMatch(template, /Building a v4 hook\? This is your market/);
});

test('the landing page does not claim production swaps are live', async () => {
  // The claim moved with the markup. Check the template document itself so the guard still bites.
  const template = await readFile(
    new URL('../public/templates/v4market/index.html', import.meta.url),
    'utf8',
  );
  const combined = `${homepage}\n${template}`;
  const overclaims = [
    /production swaps are live/i,
    /swaps are now live/i,
    /mainnet is live/i,
    /audited and ready for mainnet/i,
  ];
  for (const pattern of overclaims) {
    assert.doesNotMatch(combined, pattern, `must not claim ${pattern}`);
  }
});

test('BELL copy does not claim nothing is deployed', async () => {
  // Ten contracts plus the Yahoo verifier and four adapters are live on chain 46630. Keep the old
  // "nothing is deployed" line from coming back.
  const promises = await readFile(new URL('../components/landing/Promises.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(promises, /Nothing is deployed yet/i);
});

test('the pool directory does not imply preview fixtures are swappable', async () => {
  const pools = await readFile(new URL('../app/(app)/pools/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(pools, /\{swappable\} of \{POOLS\.length\} sample pools can currently swap/);
  assert.match(pools, /no pool exists on testnet yet/);
});

test('the swap screen still sends no transaction', async () => {
  // This is a truthful-state guard, not a wish: when the swap flow is wired it must flip to an
  // assertion that a transaction IS sent, together with the M11-03 evidence update.
  const swap = await readFile(new URL('../app/(app)/swap/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(swap, /writeContract|sendTransaction/);
});
