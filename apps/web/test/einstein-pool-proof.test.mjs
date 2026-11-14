import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [source, copy, page, route, manifest] = await Promise.all([
  read('../../../evidence/einstein/proof.json'),
  read('../components/einstein/proof.json'),
  read('../components/einstein/pool-proof-page.tsx'),
  read('../app/einstein/pool/page.tsx'),
  read('../../../evidence/deploy/pq-hooks-mainnet.json').then(JSON.parse),
]);
const proof = JSON.parse(source);

test('the page imports an exact copy of the evidence proof file', () => {
  assert.equal(copy, source, 'run scripts/einstein/build-proof.mjs to refresh the copy');
  assert.match(page, /import proof from "\.\/proof\.json"/);
  assert.match(route, /canonical: '\/einstein\/pool\/'/);
});

test('proof.json covers P1 to P11 and N1 to N7 and its contracts are the deployment manifest', () => {
  assert.deepEqual(proof.claims.map((c) => c.id), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11']);
  assert.deepEqual(proof.negatives.map((n) => n.id), ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7']);
  assert.deepEqual(proof.contracts, manifest.contracts);
});

test('a claim with no on-chain evidence can never read PASS', () => {
  for (const claim of proof.claims) {
    if (!claim.checks.length) {
      assert.ok(claim.pending, `${claim.id} says why it is pending`);
      assert.notEqual(claim.result?.verdict, 'PASS', `${claim.id} must not pass without checks`);
    }
  }
  for (const n of proof.negatives) assert.equal(n.mainnetTx, null);
});

test('the page makes no claim beyond the proof file', () => {
  assert.doesNotMatch(page, /exact match on|quantum-safe|guarantee|fully audited/i);
  assert.match(page, /Or it is marked pending/);
  const last = proof.claims.filter((c) => c.result).map((c) => c.result.verdict);
  assert.ok(!last.includes('FAIL'), 'the last replay had a failing check');
});
