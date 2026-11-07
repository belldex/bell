import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const data = JSON.parse(await read('../content/elysium-testnet.json'));
const page = await read('../components/elysium/elysium-page.tsx');
const route = await read('../app/elysium/page.tsx');
const v4 = await read('../components/v4/v4-page.tsx');
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

test('the route is static, titled, and canonical', () => {
  assert.match(route, /canonical: "\/elysium\/"/);
  assert.match(route, /export default function Page/);
  assert.doesNotMatch(route, /force-dynamic|revalidate/);
});

test('every check carries a real transaction hash and a result the page can state', () => {
  assert.ok(data.checks.length >= 8);
  for (const c of data.checks) {
    assert.match(c.tx, HASH, c.title);
    assert.ok(['PASS', 'REVERTS'].includes(c.result), c.title);
  }
  assert.ok(data.checks.some((c) => c.result === 'REVERTS'), 'a refused swap is on the page as a reverted transaction');
});

test('contracts and pools are real addresses on chain 99801', () => {
  assert.equal(data.chainId, 99801);
  for (const c of data.contracts) assert.match(c.address, ADDRESS, c.name);
  assert.equal(data.pools.length, 3);
  for (const p of data.pools) {
    assert.match(p.hook, ADDRESS);
    assert.match(p.createTx, HASH);
    assert.equal(p.maskOk, true, `${p.hook} carries the BELL mask`);
    assert.equal((BigInt(p.hook) & 0x3fffn) === 0x2cc0n, true, `${p.hook} ends in the 0x2cc0 permission bits`);
  }
});

test('source verification is shown as the explorer reports it, never as a full match it did not give', () => {
  const partial = data.contracts.filter((c) => c.source === 'partial').length;
  const full = data.contracts.filter((c) => c.source && c.source !== 'partial').length;
  assert.equal(data.verification.partial, partial);
  assert.equal(data.verification.full, full);
  assert.match(page, /PARTIAL MATCH/);
  assert.match(page, /partial match for every one|partial match/);
  // The page must not call a partial match "verified" without the qualifier.
  assert.doesNotMatch(page, /fully verified|all contracts are verified/i);
});

test('the auction figures come from the settlement record', () => {
  assert.ok(data.auction, 'a settled cycle is recorded');
  assert.match(data.auction.settleTx, HASH);
  assert.equal(data.auction.stage, 'SETTLED');
  assert.ok(Math.abs(Number(data.auction.clearingPrice) - 99) < 0.01);
});

test('the page says it is a testnet, names what is not done, and uses no mainnet claim', () => {
  assert.match(page, /test tokens that have no value/);
  assert.match(page, /not a mainnet deployment|Elysium mainnet is not deployed/);
  assert.match(page, /No keeper runs on Elysium yet/);
  assert.match(page, /unaudited/);
  assert.doesNotMatch(page, /simulasi/i);
});

test('the v4 page links to it', () => {
  assert.match(v4, /\["Elysium testnet rehearsal", "\/elysium\/"\]/);
});
