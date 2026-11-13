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
  assert.match(page, /RESEARCH\s*[·.]\s*PLANNED/);
  assert.match(page, /User wallets|user wallets/i);
  assert.match(page, /LP exits stay unconditional|never guards your exit/i);
  assert.match(page, /No PQ verifier, key registry, HybridAuth, or BellHookV3 has been deployed/);
  assert.match(page, /FIPS 205|SLH-DSA/);
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
  assert.match(styles, /max-width:\s*760px/);
});
