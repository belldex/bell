import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXPECTED_BELL_FLAGS, PERMISSION_BITS, checkHook, flagsOf, isAddress, labelOf, renderTable } from '../verify-exit-liveness.ts';

const snapshot = JSON.parse(await readFile(new URL('../../apps/web/content/exit-proof.json', import.meta.url), 'utf8'));
const WITH_REMOVE = (bits) => '0x' + (0x6657dc160e05c0ff6afe2122ca7d8244390d0000n | BigInt(bits)).toString(16).padStart(40, '0');

test('the permission table has fourteen bits and marks exactly the three exit bits', () => {
  assert.equal(PERMISSION_BITS.length, 14);
  assert.deepEqual(PERMISSION_BITS.filter((p) => p.exit).map((p) => p.name).sort(), ['afterRemoveLiquidity', 'afterRemoveLiquidityReturnDelta', 'beforeRemoveLiquidity']);
  assert.deepEqual(PERMISSION_BITS.map((p) => p.bit).sort((a, b) => a - b), [...Array(14).keys()]);
});

test('0x2cc0 sets five permissions and none of them is an exit permission', () => {
  const r = checkHook('0x6657dc160e05c0ff6afe2122ca7d8244390decc0');
  assert.equal(r.flags, EXPECTED_BELL_FLAGS);
  assert.deepEqual(r.set, ['beforeInitialize', 'beforeAddLiquidity', 'afterAddLiquidity', 'beforeSwap', 'afterSwap']);
  assert.deepEqual(r.exitSet, []);
  assert.equal(r.pass, true);
});

test('every hook address that could hold back a withdraw fails', () => {
  for (const [bit, name] of [[0x200, 'beforeRemoveLiquidity'], [0x100, 'afterRemoveLiquidity'], [0x1, 'afterRemoveLiquidityReturnDelta']]) {
    const r = checkHook(WITH_REMOVE(0x2cc0 | bit));
    assert.equal(r.pass, false, name);
    assert.deepEqual(r.exitSet, [name]);
  }
  const all = checkHook(WITH_REMOVE(0x3fff));
  assert.equal(all.exitSet.length, 3);
});

test('only the low fourteen bits of the address count', () => {
  assert.equal(flagsOf('0xffffffffffffffffffffffffffffffffffff0000'), 0);
  assert.equal(flagsOf('0x0000000000000000000000000000000000003fff'), 0x3fff);
  assert.equal(flagsOf('0xc000000000000000000000000000000000000000'), 0);
});

test('bad input is refused, not guessed', () => {
  assert.equal(isAddress('0x123'), false);
  assert.throws(() => flagsOf('0x123'));
});

test('every hook in the committed list passes and carries the BELL mask', () => {
  assert.ok(snapshot.hooks.length >= 5, 'at least the five pools of the brief');
  for (const h of snapshot.hooks) {
    assert.ok(isAddress(h.hook), h.hook);
    const r = checkHook(h.hook);
    assert.equal(r.pass, true, `${h.pair} ${h.hook} has an exit bit set`);
    assert.equal(r.flags, EXPECTED_BELL_FLAGS, `${h.hook} is not 0x2cc0`);
    assert.equal(h.flags, r.flagsHex, `${h.hook} flags in the list do not match its address`);
  }
  assert.equal(new Set(snapshot.hooks.map((h) => h.hook.toLowerCase())).size, snapshot.hooks.length, 'no hook twice');
  assert.equal(snapshot.mask, '0x2cc0');
});

test('the committed receipts only claim what has a transaction behind it', () => {
  for (const r of snapshot.receipts) {
    assert.ok(['DONE', 'PENDING'].includes(r.status), r.scenario);
    if (r.status === 'DONE') {
      assert.match(r.tx, /^0x[0-9a-f]{64}$/, r.scenario);
      assert.ok(r.when && r.session, r.scenario);
    } else {
      assert.equal(r.tx, null, `${r.scenario} is pending and must not carry a hash`);
    }
  }
  assert.ok(snapshot.receipts.some((r) => r.status === 'DONE'), 'at least one withdraw is on the record');
});

test('the table prints one line per hook with PASS or FAIL', () => {
  const out = renderTable([{ ...checkHook('0x6657dc160e05c0ff6afe2122ca7d8244390decc0'), label: 'TSLA / USDG' }, { ...checkHook(WITH_REMOVE(0x2cc0 | 0x200)), label: 'bad' }]);
  assert.match(out, /TSLA \/ USDG\s+0x6657dc160e05c0ff6afe2122ca7d8244390decc0\s+0x2cc0\s+none\s+PASS/);
  assert.match(out, /bad\s+0x[0-9a-f]{40}\s+0x2ec0\s+beforeRemoveLiquidity\s+FAIL/);
});

test('pool labels put the stock first and USDG second', () => {
  assert.equal(labelOf({ hook: '0x0', poolId: '0x0', token0: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', token1: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9' }), 'AAPL / USDG');
  assert.equal(labelOf({ hook: '0x0', poolId: '0x0', token0: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', token1: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' }), 'TSLA / USDG');
});

test('the CLI exits 0 on the committed list and 1 when an exit bit is set', () => {
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../verify-exit-liveness.ts', import.meta.url)), ...args], { encoding: 'utf8' });
  const ok = run('--snapshot');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /0 FAIL/);
  const bad = run('--hook', WITH_REMOVE(0x2cc0 | 0x200));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL/);
});
