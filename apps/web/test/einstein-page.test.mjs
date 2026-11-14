import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');

const [einstein, quantum, page, data, field, gate, ledger, motion, styles, shell, manifest, hybridAuth, keyRegistry] = await Promise.all([
  read('../app/einstein/page.tsx'),
  read('../app/quantum/page.tsx'),
  read('../components/einstein/einstein-page.tsx'),
  read('../components/einstein/einstein-data.ts'),
  read('../components/einstein/leaf-field.tsx'),
  read('../components/einstein/signature-gate.tsx'),
  read('../components/einstein/evidence-ledger.tsx'),
  read('../components/einstein/einstein-motion.tsx'),
  read('../components/einstein/einstein.css'),
  read('../components/app/AppShell.tsx'),
  read('../../../evidence/deploy/pq-hooks-mainnet.json').then(JSON.parse),
  read('../../../contracts/pq/src/HybridAuth.sol'),
  read('../../../contracts/pq/src/PQKeyRegistry.sol'),
]);
const everything = [page, data, field, gate, ledger, motion].join('\n');

test('/einstein is the canonical route and /quantum still serves the same page', () => {
  for (const route of [einstein, quantum]) {
    assert.match(route, /EinsteinPage/);
    assert.match(route, /einstein\.css/);
    assert.match(route, /canonical: '\/einstein\/'/);
    assert.match(route, /Einstein Hooks v2/);
  }
  assert.doesNotMatch(einstein + quantum, /Bell State|BELL STATE/);
});

test('the page is a public landing page, outside the dashboard shell', () => {
  assert.match(page, /LandingNav appName="BELL" sections=\{EINSTEIN_SECTIONS\}/);
  assert.doesNotMatch(page, /base="\/"/);
  assert.match(page, /LandingEffects/);
  assert.doesNotMatch(shell, /\/einstein/);
});

test('no decorative numbering and no dot separators', () => {
  assert.doesNotMatch(page, /index="0\d"|>\s*0[1-9]\s*</);
  assert.doesNotMatch(page, /\b0[1-9] —/);
  assert.doesNotMatch(everything, /[·◆◇●•]/);
});

test('the mainnet contract list is exactly the deployment manifest', () => {
  const listed = [...data.matchAll(/address: "(0x[0-9a-fA-F]{40})"/g)].map((m) => m[1].toLowerCase());
  const deployed = Object.values(manifest.contracts).map((a) => a.toLowerCase());
  assert.equal(deployed.length, 15);
  for (const address of deployed) assert.ok(listed.includes(address), `missing ${address}`);
  assert.equal(listed.filter((a) => deployed.includes(a)).length, 15);
});

test('the leaf field states the real signing budget', async () => {
  assert.match(data, /LEAF_BUDGET = 4096/);
  for (const asset of ['AAPL', 'NVDA', 'TSLA']) {
    const state = JSON.parse(await read(`../../../evidence/deploy/pq-hooks-mainnet-calendar-state-${asset}.json`));
    assert.ok(data.includes(state.governanceQueuedTxHash), `${asset} leaf transaction`);
  }
  assert.match(data, /NEXT_LEAF = SPENT_LEAVES\.length \+ 1/);
  assert.match(field, /prefers-reduced-motion/);
  assert.match(field, /aria-live="polite"/);
  assert.match(field, /onKeyDown/);
});

test('the gate uses the contracts own checks and error names', () => {
  for (const name of ['InvalidECDSA', 'InvalidPQSignature']) {
    assert.match(gate, new RegExp(name));
    assert.match(hybridAuth, new RegExp(`error ${name}\\(`));
  }
  assert.match(gate, /LeafOutOfOrder/);
  assert.match(keyRegistry, /error LeafOutOfOrder\(/);
  // ECDSA is recovered first in HybridAuth, so a forged ECDSA signature must win over a forged post-quantum one.
  assert.match(gate, /if \(ecdsa === "forged"\)[\s\S]*?InvalidECDSA/);
  assert.match(gate, /liquidity exit|Withdraw liquidity/);
});

test('every claim on the page stays inside what is true', () => {
  assert.match(page, /No pool uses this stack yet/);
  assert.match(page, /not independently audited|No independent cryptographic review/);
  assert.match(page, /Zero seconds, set at deployment and impossible to change/);
  assert.match(page, /not an exact match/);
  assert.match(page, /not\s+affiliated with or endorsed by Albert Einstein/);
  assert.match(page, /not signed with SHRINCS/);
  assert.match(ledger, /verified on Sourcify as a match/);
  assert.doesNotMatch(page, /quantum-safe|guarantee|protects your wallet|fully audited/i);
});

test('layout is responsive and motion respects the reader', () => {
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /max-width: 760px/);
  assert.match(styles, /\.ein-armed \[data-reveal\]/);
  assert.match(motion, /prefers-reduced-motion/);
  assert.match(styles, /overflow-x: auto/);
});

test('the content width follows the navbar, which spans the viewport with the site gutter', () => {
  const main = styles.match(/\.ein__main \{[^}]*\}/)?.[0] ?? '';
  assert.ok(main.length > 0, 'the .ein__main rule exists');
  assert.doesNotMatch(main, /max-width/);
  assert.match(main, /var\(--lp-gutter\)/);
  assert.match(styles, /\.ein \.legal__foot \.lp-wrap \{ max-width: none; \}/);
});

test('the leaf field says what a square is and names the first leaves', () => {
  assert.match(field, /Each square is one signature this key can ever make/);
  assert.match(field, /The first four squares, enlarged/);
  for (const asset of ['AAPL', 'NVDA', 'TSLA']) assert.match(data, new RegExp('asset: "' + asset + '"'));
});
