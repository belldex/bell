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

test('hero is pinned to the first viewport with the reference 301px top offset', async () => {
  const page = await read('../app/page.tsx');
  // Reference: .hero-inner { height:100vh; padding-top:301px } inside 200vh .hero —
  // the headline is ON SCREEN at load; the extra 100vh below is pure scroll runway.
  assert.match(page, /pt-\[301px\]/, 'hero inner must pad 301px from the top like the reference');
  assert.match(page, /h-screen/, 'hero inner must be exactly 100vh tall');
  assert.match(page, /max-w-\[1034px\]/, 'hero inner max-width 1034px');
});

test('nav and footer mirror the reference layout with BELL wording', async () => {
  const nav = await read('../components/landing/SiteNav.tsx');
  // Reference header: 58px muted ticker bar, mono 12px links, dropdown slab.
  assert.match(nav, /gap-20 whitespace-nowrap/, 'ticker bar-track present');
  assert.match(nav, /h-\[58px\]/, 'ticker bar 58px tall');
  assert.match(nav, /font-mono/, 'nav uses mono type');
  assert.match(nav, /h-\[633px\]/, 'dropdown slab present');

  const footer = await read('../components/landing/Footer.tsx');
  assert.match(footer, /grid-cols-4/, 'footer 4-column groups');
  assert.match(footer, /gdpr/, 'gdpr disclosure line present');
  assert.match(footer, /BOURSE-EVENT LIQUIDITY LAYER/i, 'BELL branding');
});

test('story sections use reference measurements (36px h2, glass cards, 7 poses)', async () => {
  const page = await read('../app/page.tsx');
  assert.match(page, /text-\[36px\]/, 'h2 36px like reference');
  assert.match(page, /backdrop-blur/, 'cards keep the glass blur');
  assert.match(page, /data-pose="6"/, 'poses 0..6 present');
});

test('hero typography matches the reference scale (94px kinetic headline, centered 200vh hero)', async () => {
  const page = await read('../app/page.tsx');
  // Reference hero: 200vh scroll runway, centered flex column, 94px/94px headline
  // with -0.04em tracking, 24px hero line, fade-up reveals.
  assert.match(page, /min-h-\[200vh\]/, 'hero must keep the 200vh scroll runway');
  const title = await read('../components/landing/KineticTitle.tsx');
  assert.match(title, /text-\[94px\]/, 'headline must be 94px like the reference');
  assert.match(title, /tracking-\[-0\.04em\]/, 'headline tracking -0.04em');
  assert.match(title, /leading-\[94px\]/, 'headline line-height 94px');
  const reveal = await read('../components/landing/Reveal.tsx');
  assert.match(reveal, /translateY|translate-y/, 'reveal must move, not just fade');
});

test('landing sections follow the reference arc with BELL content and tokens', async () => {
  const page = await read('../app/page.tsx');
  for (const marker of ['data-pose="0"', 'data-pose="7"', 'KineticTitle', 'AnimatedRows', 'SiteNav', 'LandingFooter']) {
    assert.ok(page.includes(marker), `page must contain ${marker}`);
  }
  // BELL disclosure lives in the ticker bar + footer now
  const nav = await read('../components/landing/SiteNav.tsx');
  assert.match(nav, /Production swaps are not enabled/);
  assert.match(nav, /Mainnet release has not been approved/);
  // No v4market vocabulary
  assert.doesNotMatch(page + nav, /v4 Marketplace|Uniswap v4 hooks|Pons coin|V4M/i);
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
