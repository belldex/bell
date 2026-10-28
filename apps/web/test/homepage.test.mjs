import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('landing is a real Next page that renders BELL components — not a redirect to static HTML', async () => {
  const page = await read('../app/page.tsx');
  assert.doesNotMatch(page, /window\.location\.(replace|assign)/, 'must not redirect');
  assert.doesNotMatch(page, /templates\/v4market/, 'must not reference the copied template build');
  assert.match(page, /from '@\/components\/landing/, 'must compose landing components');
});

test('the copied template build and helper scripts are deleted from the repo', async () => {
  const { access, constants } = await import('node:fs/promises');
  const gone = [
    '../public/templates/v4market/index.html',
    '../public/templates/bell/index.html',
    '../public/v4market-source/index.html',
    '../../scripts/tooling/adapt-v4market-landing.mjs',
  ];
  for (const path of gone) {
    await assert.rejects(
      access(new URL(path, import.meta.url), constants.F_OK),
      { code: 'ENOENT' },
      `${path} must be deleted`,
    );
  }
});

test('the 3D scene is a genuine Three.js port with the reference pose system', async () => {
  const scene = await read('../components/landing/Scene.tsx');
  assert.match(scene, /from 'three'/);
  assert.match(scene, /InstancedMesh/);
  assert.match(scene, /getBoundingClientRect\(\)\.top/);
  assert.match(scene, /prefers-reduced-motion/);
  assert.match(scene, /\.dispose\(\)/, 'must clean up');
  // BELL design tokens, not the reference's palette
  assert.match(scene, /3CE6FF/, 'hot accent must be BELL ion cyan');
  assert.doesNotMatch(scene, /FF5A1F/, 'reference orange must not leak');
});

test('landing sections follow the reference arc with BELL content and tokens', async () => {
  const page = await read('../app/page.tsx');
  for (const marker of ['data-pose="0"', 'data-pose="6"', 'KineticTitle', 'AnimatedRows', 'SiteNav', 'LandingFooter']) {
    assert.ok(page.includes(marker), `page must contain ${marker}`);
  }
  // BELL disclosure preserved
  assert.match(page, /Production swaps are not enabled/);
  assert.match(page, /Mainnet release has not been approved/);
  // No v4market vocabulary
  assert.doesNotMatch(page, /v4 Marketplace|Uniswap v4 hooks|Pons coin|V4M/i);
});

test('landing styling uses the BELL design system, not a copied stylesheet', async () => {
  await assert.rejects(read('../app/landing.css'), { code: 'ENOENT' }, 'copied landing.css must be deleted');
  const page = await read('../app/page.tsx');
  assert.match(page, /className=/, 'must use BELL classes');
});

test('homepage keeps honest testnet-rehearsal claims', async () => {
  const combined = await read('../app/page.tsx');
  const overclaims = [/production swaps are live/i, /mainnet is live/i, /audited and ready/i];
  for (const pattern of overclaims) assert.doesNotMatch(combined, pattern);
});

test('swap screen still gates on onchain policy', async () => {
  const swap = await read('../app/(app)/swap/page.tsx');
  const panel = await read('../components/swap/LiveSwapPanel.tsx');
  assert.match(panel, /functionName: 'swap'/);
  assert.match(panel, /readLivePool/);
  assert.match(panel, /pool\.canSwap/);
});
