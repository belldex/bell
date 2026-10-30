import test from 'node:test';
import assert from 'node:assert/strict';
import { access, constants, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('landing route composes the current BELL landing page without redirecting', async () => {
  const page = await read('../app/page.tsx');
  assert.match(page, /LandingPage/);
  assert.match(page, /@\/components\/landing\/gyevo\/landing-page/);
  assert.doesNotMatch(page, /window\.location\.(replace|assign)|templates\/v4market/);
});

test('copied template build artifacts are absent', async () => {
  for (const path of [
    '../public/templates/v4market/index.html',
    '../public/templates/bell/index.html',
    '../public/v4market-source/index.html',
    '../../scripts/tooling/adapt-v4market-landing.mjs',
  ]) {
    await assert.rejects(access(new URL(path, import.meta.url), constants.F_OK), { code: 'ENOENT' });
  }
});

test('app shell exposes wallet, Mainnet status, accessible navigation and live app routes', async () => {
  const shell = await read('../components/app/AppShell.tsx');
  for (const path of ['/pools', '/swap', '/create', '/positions', '/protocol']) assert.ok(shell.includes(`href: '${path}'`));
  assert.match(shell, /WalletButton/);
  assert.match(shell, /MainnetStatusBanner/);
  assert.match(shell, /aria-current=\{isActive\(href\) \? 'page' : undefined\}/);
  assert.match(shell, /mobileOpen/);
  assert.match(shell, /Escape/);
});

test('live pool directory reads the Worker API and has an honest empty state', async () => {
  const pools = await read('../app/(app)/pools/page.tsx');
  const adapter = await read('../lib/mainnet-live.ts');
  assert.match(pools, /readLivePools\(/);
  assert.match(pools, /No Mainnet pools yet/);
  assert.match(pools, /Pool details/);
  assert.match(adapter, /replace\(\/\\\/quote\$\/.*\/pools/);
  assert.match(adapter, /Number\(body\.chainId\) !== MAINNET\.chainId/);
  assert.match(adapter, /client\.getLogs/);
  assert.match(adapter, /functionName: 'getPolicy'/);
  assert.doesNotMatch(pools, /from ['"]@\/lib\/fixtures/);
});

test('pool detail is resolved from Mainnet events and links to the selected live swap', async () => {
  const detail = await read('../app/(app)/pool/page.tsx');
  assert.match(detail, /readLivePools\(/);
  assert.match(detail, /Pool not found on Mainnet/);
  assert.match(detail, /swap\?hook=\$\{pool\.hook\}/);
  assert.match(detail, /getPolicy|policy\./);
  assert.doesNotMatch(detail, /from ['"]@\/lib\/fixtures/);
});

test('swap gets signed stock bundles and verifies the bundle belongs to each pool asset', async () => {
  const swap = await read('../app/(app)/swap/page.tsx');
  assert.match(swap, /MAINNET\.quoteUrl/);
  assert.match(swap, /body\.assetId\?\.toLowerCase\(\)/);
  assert.match(swap, /oracleUpdate\(body\)/);
  const adapter = await read('../lib/mainnet-live.ts');
  assert.match(adapter, /directSignature: bundle\.directSignature/);
  assert.match(swap, /simulateContract/);
  assert.doesNotMatch(swap, /const RATE:|Illustrative quote|Preview only/);
});

test('swap approval and BellRouter transaction wait for confirmed receipts', async () => {
  const swap = await read('../app/(app)/swap/page.tsx');
  assert.match(swap, /functionName: 'approve'/);
  assert.match(swap, /functionName: 'swap'/);
  assert.match(swap, /waitForTransactionReceipt/);
  assert.match(swap, /receipt\.status !== 'success'/);
  assert.match(swap, /robinhoodchain\.blockscout\.com\/tx/);
  assert.match(swap, /expectedConfigHash: pool\.configHash/);
  assert.match(swap, /limitAmount: quote\.minOut/);
});

test('quote and pool Worker reads are public, no-store and CORS enabled', async () => {
  const worker = await read('../../../workers/keeper-b/src/index.ts');
  assert.match(worker, /\['\/quote', '\/pools'\]/);
  assert.match(worker, /access-control-allow-origin', '\*'/);
  assert.match(worker, /'cache-control': 'no-store'/);
  assert.match(worker, /BELL_POOL_FACTORY/);
  assert.match(worker, /toEventSelector\(POOL_CREATED_EVENT\)/);
});

test('unavailable create and position flows do not fake transaction success', async () => {
  const create = await read('../app/(app)/create/page.tsx');
  const positions = await read('../app/(app)/positions/page.tsx');
  assert.match(create, /Preview|unavailable/i);
  assert.doesNotMatch(create, /setTimeout\(\(\) => setDone\('ok'\)/);
  assert.match(positions, /Preview only|sample position|No live position NFT loaded/i);
  assert.doesNotMatch(positions, /setCollected\(true\)|Simulate remove/);
});

test('legal and protocol pages resolve from the shared app navigation', async () => {
  for (const path of ['protocol', 'privacy', 'terms', 'cookies']) {
    assert.match(await read(`../app/(app)/${path}/page.tsx`), /export default/);
  }
});
