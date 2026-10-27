import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const homepage = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

test('BELL homepage renders every editorial section it links to', () => {
  // These class names are the contract between page.tsx and globals.css. They were once asserted
  // as .bar-track/.tcard/.cases, which no longer exist anywhere — the test was passing vacuously
  // only because it was never wired into `pnpm test:unit`. Assert what the markup actually uses.
  const sections = [
    'bell-topline',
    'bell-hdr',
    'bell-hero',
    'bell-trust-strip',
    'bell-story-card',
    'bell-wall',
    'bell-build',
    'bell-footer',
  ];
  for (const section of sections) {
    assert.match(homepage, new RegExp(`className="[^"]*\\b${section}\\b`), `page.tsx must render .${section}`);
    assert.match(styles, new RegExp(`\\.${section}\\b`), `globals.css must style .${section}`);
  }
});

test('BELL homepage links to the three live app destinations', () => {
  assert.match(homepage, /href="\/pools"/);
  assert.match(homepage, /href="\/create"/);
  assert.match(homepage, /href="\/swap"/);
});

test('BELL marquee uses the reference 22-second linear loop and stops for reduced motion', () => {
  assert.match(styles, /\.bell-marquee-track\s*\{[^}]*animation:\s*bell-marquee\s+22s\s+linear\s+infinite/s);
  assert.match(styles, /@keyframes bell-marquee[\s\S]*?to\s*\{\s*transform:\s*translateX\(-50%\)/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*?\.bell-marquee-track\s*\{[^}]*animation:\s*none/s);
});

test('BELL hero status does not claim production swaps are live', () => {
  assert.match(homepage, /Rehearsal build/);
  assert.match(homepage, /Production swaps are not enabled/);
  assert.match(homepage, /Mainnet release has not been approved/);
});

test('BELL copy does not claim nothing is deployed', async () => {
  // The landing page used to say "Nothing is deployed yet" while ten contracts plus the Yahoo
  // verifier and adapters were live on chain 46630. Keep that claim from coming back.
  const promises = await readFile(new URL('../components/landing/Promises.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(promises, /Nothing is deployed yet/i);
  assert.match(promises, /Contracts are deployed on testnet for rehearsal/);
});

test('the pool directory does not imply preview fixtures are swappable', async () => {
  const pools = await readFile(new URL('../app/(app)/pools/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(pools, /\{swappable\} of \{POOLS\.length\} sample pools can currently swap/);
  assert.match(pools, /no pool exists on testnet yet/);
});
