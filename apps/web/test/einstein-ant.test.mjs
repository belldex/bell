import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const proof = JSON.parse(readFileSync(new URL('../components/einstein/ant-proof.json', import.meta.url), 'utf8'));
const source = JSON.parse(readFileSync(new URL('../../../evidence/einstein/ant/proof.json', import.meta.url), 'utf8'));
const page = readFileSync(new URL('../components/einstein/ant-page.tsx', import.meta.url), 'utf8');

test('the page reads the same proof file the script writes', () => {
  assert.deepEqual(proof, source);
});

test('claims A1 to A7 are all there, and every claim but A1 says what it waits for', () => {
  assert.deepEqual(proof.claims.map((c) => c.id), ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
  for (const c of proof.claims.slice(1)) assert.ok(c.blockedBy && c.blockedBy.length > 10, `${c.id} has no blockedBy`);
});

test('the status never says ANT is live while a blocker is recorded', () => {
  assert.equal(proof.status, 'blocked');
  assert.match(proof.statusNote, /cannot be admitted/);
  assert.doesNotMatch(page, /ANT is live/i);
  assert.equal(proof.blocker.id, 'B1');
  assert.ok(proof.blocker.why.length >= 2);
});

test('the ANT address is the one Robinhood lists, and the look-alikes are kept apart', () => {
  assert.equal(proof.a1.address, '0xbbB6c29bCc3a1028A2B54310DF73F4F7A3bcB373');
  const lookalikes = proof.a1.lookalikes.map((l) => l.address.toLowerCase());
  assert.ok(!lookalikes.includes(proof.a1.address.toLowerCase()));
  assert.equal(new Set(lookalikes).size, 2);
  assert.ok(proof.a1.sources.some((s) => s.url === 'https://docs.robinhood.com/chain/contracts'));
  assert.ok(proof.a1.sources.some((s) => s.url === 'https://api.robinhood.com/rhj/assets'));
});

test('a replay verdict is recorded for A1 only when the replay really passed it', () => {
  const line = (proof.replay ?? []).find((l) => l.startsWith('A1 '));
  assert.ok(line, 'no A1 replay line');
  assert.match(line, /\sPASS\s/);
  assert.ok(!(proof.replay ?? []).some((l) => /^A[2-7]\s+PASS/.test(l)), 'a pool claim is marked PASS before a pool exists');
});

test('the compliance notes the brief requires are on the page', () => {
  const text = proof.compliance.join(' ');
  assert.match(text, /Robinhood Assets \(Jersey\) Limited/);
  assert.match(text, /not Anthropic equity/);
  assert.match(text, /U\.S\. persons/);
  assert.match(text, /not affiliated with Robinhood or Anthropic/);
  assert.doesNotMatch(page, /anthropic.*logo\.(png|svg)/i);
});

test('the testnet rehearsal is labelled as a rehearsal and each step is proven only when the replay says so', () => {
  const r = proof.rehearsal;
  assert.ok(r, 'no rehearsal section');
  assert.equal(r.network.id, 46630);
  assert.match(r.note, /not ANT and it is not mainnet/);
  assert.deepEqual(r.steps.map((s) => s.id), ['R1', 'A2', 'A3', 'A4', 'A5', 'A6']);
  for (const s of r.steps.filter((x) => x.verdict === 'PASS')) {
    const line = (proof.replay ?? []).find((l) => l.startsWith(`R:${s.id} `));
    assert.ok(line && /\sPASS\s/.test(line), `${s.id} is marked PASS without a PASS replay line`);
  }
  assert.ok(r.steps.every((s) => s.txs.every((t) => /^0x[0-9a-f]{64}$/i.test(t.tx) && t.url.startsWith(r.network.explorer))));
});

test('mainnet claims stay pending while the rehearsal passes', () => {
  assert.equal(proof.status, 'blocked');
  assert.ok(!(proof.replay ?? []).some((l) => /^A[2-7]\s+PASS/.test(l)));
});
