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

test('all app routes use the reference-like shared shell and real BELL navigation', async () => {
  const shell = await read('../components/app/AppShell.tsx');
  for (const path of ['/pools', '/swap', '/create', '/positions', '/protocol']) {
    assert.ok(shell.includes(`href: '${path}'`), `navigation must contain ${path}`);
  }
  assert.match(shell, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(shell, /WalletButton/);
  assert.match(shell, /TestnetBanner/);
  assert.doesNotMatch(shell, /templates\/v4market/);
});

test('preview UI never claims fake creation or position actions succeeded', async () => {
  const create = await read('../app/(app)/create/page.tsx');
  const positions = await read('../app/(app)/positions/page.tsx');
  assert.doesNotMatch(create, /setTimeout\(\(\) => setDone\('ok'\)/);
  assert.doesNotMatch(create, /Simulated create \(preview\)/);
  assert.doesNotMatch(positions, /onClick=\{\(\) => setCollected\(true\)\}/);
  assert.doesNotMatch(positions, /Simulate remove/);
  assert.match(create, /Preview|unavailable/i);
  assert.match(positions, /Preview only|not connected|not available/i);
});

test('pool directory distinguishes preview fixtures from live chain state', async () => {
  const pools = await read('../app/(app)/pools/page.tsx');
  assert.match(pools, /preview fixtures/i);
  assert.doesNotMatch(pools, /no pool exists on testnet yet/i);
  assert.match(pools, /testnet|onchain/i);
});

test('create wizard cannot claim a pool was created by a timer', async () => {
  const create = await read('../app/(app)/create/page.tsx');
  assert.doesNotMatch(create, /window\.setTimeout\(\(\) => setDone\('ok'\)/);
  assert.doesNotMatch(create, /Simulated create \(preview\)/);
  assert.match(create, /Preview only|No live factory|not enabled|no live factory flow/i);
});

test('positions do not pretend sample NFTs can add, remove, or collect', async () => {
  const positions = await read('../app/(app)/positions/page.tsx');
  assert.doesNotMatch(positions, /onClick=\{\(\) => setCollected\(true\)\}/);
  assert.doesNotMatch(positions, /Simulate remove/);
  assert.match(positions, /Preview only|sample position/i);
});

test('five app routes retain route-specific behavior while sharing the app shell', async () => {
  const shell = await read('../components/app/AppShell.tsx');
  for (const route of ['/pools', '/swap', '/create', '/positions']) {
    assert.ok(shell.includes(`href: '${route}'`), `app navigation has ${route}`);
  }
  assert.match(shell, /WalletButton/);
  assert.match(shell, /TestnetBanner/);
  assert.match(shell, /aria-current/);
});

test('navigation destinations all resolve to implemented BELL pages', async () => {
  const routes = [
    '../app/(app)/pools/page.tsx',
    '../app/(app)/pool/page.tsx',
    '../app/(app)/create/page.tsx',
    '../app/(app)/swap/page.tsx',
    '../app/(app)/positions/page.tsx',
  ];
  for (const route of routes) assert.ok((await read(route)).length > 0, `${route} exists`);
  const appShell = await read('../components/app/AppShell.tsx');
  const landingNav = await read('../components/landing/SiteNav.tsx');
  assert.doesNotMatch(`${appShell}\n${landingNav}`, /templates\/v4market/);
});

test('all five app pages share the reference mono labels, hard-edged panels, and BELL palette', async () => {
  const pages = [
    '../app/(app)/pools/page.tsx',
    '../app/(app)/pool/page.tsx',
    '../app/(app)/create/page.tsx',
    '../app/(app)/swap/page.tsx',
    '../app/(app)/positions/page.tsx',
  ];
  for (const route of pages) {
    const source = await read(route);
    assert.match(source, /font-mono/, `${route} needs reference mono labels`);
    assert.match(source, /rounded-none|rounded-xl|rounded-2xl/, `${route} needs structured panels`);
    assert.match(source, /text-ion|bg-ion/, `${route} must retain BELL accent`);
  }
});

test('protocol and legal links land on implemented pages', async () => {
  for (const path of ['protocol', 'privacy', 'terms', 'cookies']) {
    const page = await read(`../app/(app)/${path}/page.tsx`);
    assert.match(page, /export default/);
  }
});

test('pool cards and position fixtures are visibly preview-only', async () => {
  const card = await read('../components/policy/PoolCard.tsx');
  assert.match(card, /Preview fixture · not onchain/);
  const detail = await read('../app/(app)/pool/page.tsx');
  assert.match(detail, /sample policy fixture/);
  assert.match(detail, /Fixture only/);
  const positions = await read('../app/(app)/positions/page.tsx');
  assert.match(positions, /Sample position only/);
  assert.match(positions, /no position NFT has been read/);
});

test('swap fixture controls never lead into a fake submit timeline', async () => {
  const swap = await read('../app/(app)/swap/page.tsx');
  assert.doesNotMatch(swap, /setStage\('(provisional|confirmed)'/);
  assert.match(swap, /No executable fixture quote/);
  assert.match(swap, /Preview only/);
});

test('deployed rehearsal hook is read onchain with explicit evidence address, never inferred from fixtures', async () => {
  const panel = await read('../components/swap/LiveSwapPanel.tsx');
  assert.match(panel, /0x549f0C6657d9E39a034f7524E501D218B2c6acc0/i);
  assert.match(panel, /readLivePool\(/);
  assert.match(panel, /wallet\.chainId === TESTNET\.chainId/);
  assert.match(panel, /Connect wallet to read the live policy/);
  assert.doesNotMatch(panel, /http\(\)/, 'must not create a public client without an RPC URL');
  assert.match(panel, /if \(!current\.canSwap/, 'must re-check policy immediately before transaction');
  assert.match(panel, /0x549f0C6657d9E39a034f7524E501D218B2c6acc0|deployed rehearsal hook/i);
});

test('pool directory exposes the deployed rehearsal policy separately from fixture cards', async () => {
  const pools = await read('../app/(app)/pools/page.tsx');
  assert.match(pools, /RehearsalPoolCard/);
  const liveCard = await read('../components/policy/RehearsalPoolCard.tsx');
  assert.match(liveCard, /readLivePool/);
  assert.match(liveCard, /0x549f0C6657d9E39a034f7524E501D218B2c6acc0/i);
  assert.match(liveCard, /0xc2b56af343d2bcf1d9729517223fed8b6c2ec16f748e25a2d281c21c49e2e0ea/i);
  assert.match(liveCard, /144043685/);
  assert.match(liveCard, /wallet\.chainId|wallet\.status/);
  assert.match(liveCard, /reasonBits/);
  assert.match(liveCard, /Preview fixture/);
});

test('fixture pool details do not borrow the deployed WETH/AAPL hook identity', async () => {
  const detail = await read('../app/(app)/pool/page.tsx');
  assert.doesNotMatch(detail, /549f0C6657d9E39a034f7524E501D218B2c6acc0/i);
  assert.match(detail, /fixture.*not executable|Preview fixture/i);
});

test('mobile app navigation has 44px targets and all routes, while current route semantics remain', async () => {
  const shell = await read('../components/app/AppShell.tsx');
  assert.match(shell, /min-h-12/);
  assert.match(shell, /aria-label="App \(mobile\)"/);
  assert.match(shell, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(shell, /href: '\/protocol'/);
});

test('app routes share a consistent reference-width content rail and body contrast tokens', async () => {
  const shell = await read('../components/app/AppShell.tsx');
  assert.match(shell, /max-w-\[1440px\]/, 'header, main, footer share 1440px rail');
  assert.doesNotMatch(shell, /max-w-6xl/, 'avoid narrower mismatched footer/content rail');
  for (const path of ['../app/(app)/pools/page.tsx', '../app/(app)/pool/page.tsx', '../app/(app)/create/page.tsx', '../app/(app)/swap/page.tsx', '../app/(app)/positions/page.tsx']) {
    const page = await read(path);
    assert.match(page, /text-muted|text-ink/, `${path} uses semantic readable text colors`);
  }
});

test('AppShell exposes a working mobile menu, closes it on route navigation, and returns focusable routes', async () => {
  const shell = await read('../components/app/AppShell.tsx');
  assert.match(shell, /mobileOpen/);
  assert.match(shell, /aria-expanded/);
  assert.match(shell, /setMobileOpen\(false\)/);
  assert.match(shell, /Escape/);
  assert.match(shell, /\/privacy|\/terms|\/cookies/);
});

test('position preview cards have working info disclosures but no fake write controls', async () => {
  const positions = await read('../app/(app)/positions/page.tsx');
  assert.match(positions, /setMode\(mode === 'remove'/);
  assert.match(positions, /setMode\(mode === 'add'/);
  assert.match(positions, /No live position NFT loaded/);
  assert.doesNotMatch(positions, /setCollected\(|setRemoved\(/);
});

test('create wizard remains navigable through all five preview steps and final action is explicitly unavailable', async () => {
  const create = await read('../app/(app)/create/page.tsx');
  assert.match(create, /const STEPS = \['Pair', 'Mode', 'Seed & price', 'Caps', 'Review'\]/);
  assert.match(create, /setStep\(\(s\) => s \+ 1\)/);
  assert.match(create, /setStep\(\(s\) => Math\.max\(0, s - 1\)\)/);
  assert.match(create, /Create unavailable — no live factory flow/);
  assert.doesNotMatch(create, /setTimeout/);
});

test('swap preview controls recalculate locally and all selections are keyboard/touch accessible', async () => {
  const swap = await read('../app/(app)/swap/page.tsx');
  assert.match(swap, /setFlip\(/);
  assert.match(swap, /setMode\(/);
  assert.match(swap, /setSlip\(/);
  assert.match(swap, /setQuote\(compute\(\)\)/);
  assert.match(swap, /min-h-10/);
  assert.doesNotMatch(swap, /setStage\('(provisional|confirmed)'/);
});
