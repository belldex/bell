import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('wallet app resolves every active core address and scan block from current Mainnet evidence', async () => {
  const [live, positions, manifestText, verificationText] = await Promise.all([
    read('../lib/mainnet-live.ts'),
    read('../app/(app)/positions/page.tsx'),
    read('../../../evidence/deploy/mainnet-4663.json'),
    read('../../../evidence/deploy/mainnet-4663-verification.json'),
  ]);
  const deployment = JSON.parse(manifestText);
  const verification = JSON.parse(verificationText);

  assert.match(live, /import deployment from ['"].*mainnet-4663\.json['"]/);
  assert.match(live, /import verification from ['"].*mainnet-4663-verification\.json['"]/);
  for (const [key, evidenceKey] of [
    ['factory', 'poolFactory'], ['router', 'router'], ['weth', 'weth'],
    ['assetRegistry', 'assetRegistry'], ['calendarRegistry', 'calendarRegistry'],
    ['sessionRegistry', 'sessionRegistry'], ['positionManager', 'positionManager'],
  ]) {
    assert.match(live, new RegExp(`${key}:\\s*deployment\\.${evidenceKey}`));
    assert.equal(typeof deployment[evidenceKey], 'string');
  }
  assert.match(live, /deploymentBlock:\s*BigInt\(verification\.blocks\.verifiedAtBlock\)/);
  assert.ok(Number.isSafeInteger(verification.blocks.verifiedAtBlock) && verification.blocks.verifiedAtBlock > 0);
  assert.match(positions, /const manager = MAINNET\.positionManager/);

  for (const staleAddress of [
    '0x7bd927dbe86fe403463e543cad2804386b66e730',
    '0x2dbcb85d5703d7e2f69f05955f0d461b38d148eb',
    '0xba9b5142f282dde204805d66fddb5d6256080926',
    '0xe2380390ee342ad42dc463d6518f1e67cc5a52c3',
    '0x4bd4f5fcb1c73890d8166f046b9f71188e004a14',
  ]) {
    assert.doesNotMatch(live + positions, new RegExp(staleAddress, 'i'));
  }
});
