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
  for (const n of proof.negatives) {
    if (n.mainnetTx === null) { assert.equal(n.status, 'PENDING'); continue; }
    // A proven negative test must carry a replayable check, not just a claim.
    assert.match(n.mainnetTx, /^0x[0-9a-f]{64}$/);
    assert.equal(n.status, 'PROVEN');
    assert.equal(n.check.kind, 'revertReason');
  }
});

test('the page makes no claim beyond the proof file', () => {
  assert.doesNotMatch(page, /exact match on|quantum-safe|guarantee|fully audited/i);
  assert.match(page, /Or it says pending/);
  const last = proof.claims.filter((c) => c.result).map((c) => c.result.verdict);
  assert.ok(!last.includes('FAIL'), 'the last replay had a failing check');
});

test('the PQ keeper Worker points at the deployed PQ stack and not at the production one', async () => {
  const cfg = JSON.parse((await read('../../../workers/keeper-b/wrangler.pq.jsonc')));
  const prod = JSON.parse((await read('../../../workers/keeper-b/wrangler.jsonc')).replace(/^\s*\/\/.*$/gm, ''));
  const c = manifest.contracts;
  assert.equal(cfg.name, 'bell-keeper-pq');
  assert.equal(cfg.vars.BELL_CALENDAR_REGISTRY, c.calendarRegistry.toLowerCase());
  assert.equal(cfg.vars.BELL_SESSION_REGISTRY, c.sessionRegistry.toLowerCase());
  assert.equal(cfg.vars.BELL_POOL_FACTORY, c.poolFactory.toLowerCase());
  assert.equal(cfg.vars.BELL_AUCTION_REGISTRY, c.auctionRegistry.toLowerCase());
  assert.notEqual(cfg.vars.BELL_CALENDAR_REGISTRY, prod.vars.BELL_CALENDAR_REGISTRY);
  assert.notEqual(cfg.name, prod.name);
  const roots = JSON.parse(cfg.vars.BELL_CALENDAR_ROOTS);
  for (const a of ['AAPL', 'NVDA', 'TSLA']) {
    const state = JSON.parse(await read(`../../../evidence/deploy/pq-hooks-mainnet-calendar-state-${a}.json`));
    assert.equal(roots[a].root, state.root);
  }
});
