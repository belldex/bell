import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const homepage = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const template = await readFile(
  new URL('../public/templates/v4market/index.html', import.meta.url),
  'utf8',
).catch(() => '');

test('the landing page delegates to the pinned v4market template document', () => {
  assert.match(homepage, /\/templates\/v4market\/index\.html/);
});

test('the landing page does not claim production swaps are live', () => {
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
  const promises = await readFile(new URL('../components/landing/Promises.tsx', import.meta.url), 'utf8').catch(() => '');
  if (promises) assert.doesNotMatch(promises, /Nothing is deployed yet/i);
});

test('the pool directory does not imply preview fixtures are swappable', async () => {
  const pools = await readFile(new URL('../app/(app)/pools/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(pools, /\{swappable\} of \{POOLS\.length\} sample pools can currently swap/);
});

test('the swap screen contains a live onchain swap path', async () => {
  const swap = await readFile(new URL('../app/(app)/swap/page.tsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../components/swap/LiveSwapPanel.tsx', import.meta.url), 'utf8');
  const lib = await readFile(new URL('../lib/live-swap.ts', import.meta.url), 'utf8');
  const combined = `${swap}\n${panel}\n${lib}`;
  // The live path must really send transactions: router swap, approval, and onchain policy read.
  assert.match(combined, /functionName: 'swap'/, 'must call the router swap');
  assert.match(combined, /functionName: 'approve'/, 'must approve the router before swapping');
  assert.match(combined, /readLivePool/, 'must read the hook policy onchain');
  assert.match(panel, /LiveSwapPanel|Live pool/, 'panel must be present');
});

test('the live swap panel never bypasses onchain policy', () => {
  // A fake success or a client-side tradability check would be a lie. The panel must show the
  // protocol's answer, and a halted pool must not reach the router.
  const panel = readFile(new URL('../components/swap/LiveSwapPanel.tsx', import.meta.url), 'utf8');
  return panel.then((src) => {
    assert.match(src, /pool\.canSwap/, 'must gate on the onchain policy read');
    assert.doesNotMatch(src, /setStage\('done'\)\s*;?\s*\/\/\s*simulate/i, 'must not fake success');
  });
});
