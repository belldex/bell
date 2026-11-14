import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = async (path) => {
  try {
    return await readFile(new URL(path, import.meta.url), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
};

const [route, page, shell, styles] = await Promise.all([
  read('../app/quantum/page.tsx'),
  read('../components/quantum/quantum-page.tsx'),
  read('../components/app/AppShell.tsx'),
  read('../components/quantum/quantum.css'),
]);

test('quantum research route explains the protections and their limits', () => {
  assert.match(route, /QuantumPage/);
  assert.match(page, /Quantum-safe<br \/><em>market structure/);
  assert.match(page, /MAINNET CONTRACTS LIVE/);
  assert.match(page, /User wallets|user wallets/i);
  assert.match(page, /LP exits stay unconditional|never guards your exit/i);
  assert.match(page, /BellSHRINCSStatefulVerifier/);
  assert.match(page, /Elysium testnet/i);
  assert.match(page, /Robinhood Chain Mainnet/);
  assert.match(page, /synthetic/i);
  assert.doesNotMatch(page, /Nothing PQ is live yet/);
  assert.match(page, /FIPS 205|SLH-DSA/);
});

test('quantum page publishes testnet deployment and hybrid-auth evidence without overstating scope', () => {
  assert.match(page, /0x158895a1fBabfA91Cae1264f1D959cBe6b7A4101/i);
  assert.match(page, /0xb4C7cFb2F1b58AfE602249E24Ec0476e4F984A14/i);
  assert.match(page, /0xBc81138DfC3285287Fa15745524ef2f5A9192dC6/i);
  assert.match(page, /0xed149c5f89abf0f96bb25e85a15197a94e067a469638d631e09cf22bd1ae3361/i);
  assert.match(page, /0x3bcf5a7d9f0ef7b54ce3fba9efd26bde1d72a97fcc27fb55a5ea8e6d0f0ef30f/i);
  assert.match(page, /0x6b4696d282be4ceb4e5597de7792808ea4bd84285d21f6c5a6890e41d0d75032/i);
  assert.match(page, /324,563/);
  assert.match(page, /not.*audited|unaudited/i);
  assert.match(page, /stateful-only/i);
  assert.match(page, /Sourcify|source verification/i);
});

test('quantum research is a public landing page, outside the dashboard shell', () => {
  assert.match(page, /const QUANTUM_SECTIONS = \[/);
  assert.match(page, /LandingNav appName="BELL" sections=\{QUANTUM_SECTIONS\}/);
  assert.doesNotMatch(page, /base="\/"/);
  assert.match(page, /LandingEffects/);
  assert.doesNotMatch(shell, /\/quantum/);
});

test('quantum layout has responsive and reduced-motion behavior', () => {
  assert.match(styles, /\.quantum-page/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /max-width:.{0,8}760px/);
});

test('the page is named Einstein Hooks v2 and /einstein is the canonical route', async () => {
  const einstein = await read('../app/einstein/page.tsx');
  assert.match(einstein, /QuantumPage/);
  assert.match(einstein, /Einstein Hooks v2/);
  assert.match(einstein, /canonical: '\/einstein\/'/);
  assert.match(route, /canonical: '\/einstein\/'/);
  assert.match(page, /EINSTEIN HOOKS V2/);
  assert.match(page, /not affiliated with or endorsed by/);
  assert.doesNotMatch(page + route + einstein, /Bell State|BELL STATE/);
});

test('the page states what is live on Mainnet and what is not', () => {
  assert.match(page, /const mainnetContracts = \[/);
  for (const address of ['0x190ca8f13e381d1E58211cc821226EF9161d3a57', '0xF6b38e322Ce6d8F9F836921278e13aE55F525569', '0x5518541aA2D4b45531d7a2506FA81FFdFb4d505d']) {
    assert.match(page, new RegExp(address, 'i'));
  }
  assert.match(page, /No pool uses them yet/);
  assert.match(page, /no timelock delay|timelock delay of zero/i);
  assert.match(page, /No independent cryptographic review/);
  assert.match(page, /verified on Sourcify with a creation and runtime/);
  assert.match(page, /not an “exact match”/);
  assert.doesNotMatch(page, /Mainnet deployment, Sourcify exact match|remain gated/);
  assert.doesNotMatch(page, /Mainnet hook integration remains gated|Mainnet deployment yet/);
});
