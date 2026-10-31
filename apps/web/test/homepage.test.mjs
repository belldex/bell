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

test('page metadata no longer reports outdated asset admission status', async () => {
  const layout = await read('../app/layout.tsx');
  assert.match(layout, /Session-aware Robinhood Stock Token liquidity/);
  assert.match(layout, /less than 120 seconds old; stale data halts swaps/);
  assert.doesNotMatch(layout, /signed quotes/i);
  assert.doesNotMatch(layout, /Asset admission and active pools are pending verification/i);
});

test('served landing and legal copy describe Mainnet and enabled wallet flows truthfully', async () => {
  const landing = await read('../components/landing/gyevo/sections.tsx');
  const footer = await read('../components/landing/gyevo/final-reveal.tsx');
  const nav = await read('../components/landing/gyevo/landing-nav.tsx');
  const cover = await read('../components/landing/gyevo/cover-reveal.tsx');
  const terms = await read('../app/(app)/terms/page.tsx');
  const privacy = await read('../app/(app)/privacy/page.tsx');
  const publicCopy = [landing, footer, nav, cover, terms, privacy].join('\n');
  for (const obsolete of [/Testnet only/i, /Testnet snapshot/i, /No protocol deployment/i, /sample pools/i, /No swap or pool creation transaction is enabled/i, /no Mainnet deployment/i]) {
    assert.doesNotMatch(publicCopy, obsolete);
  }
  assert.match(landing, /No Mainnet pool|no pool has been created/i);
  assert.match(landing, /Worker/i);
  assert.match(footer, /Create pool/i);
  assert.match(terms, /wallet/i);
  assert.match(privacy, /Worker|session-feed/i);
  assert.match(publicCopy, /not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc\./i);
  assert.doesNotMatch(publicCopy, /tokenized[- ]stocks?|tokenized[- ]equities/i);
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

test('swap reads Chainlink stock prices onchain without Worker-signed bundles', async () => {
  const swap = await read('../app/(app)/swap/page.tsx');
  assert.match(swap, /source === 'chainlink-feed'/);
  assert.match(swap, /return \[\]/);
  assert.doesNotMatch(swap, /MAINNET\.quoteUrl|oracleUpdate\(body\)/);
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
  assert.match(swap, /limitAmount: exactInput \? quote\.minOut : quote\.maxIn/);
  assert.match(swap, /Exact output/);
  assert.match(swap, /Maximum paid/);
});

test('asset and pool pickers expose real token logos and pair identities', async () => {
  const create = await read('../app/(app)/create/page.tsx');
  const swap = await read('../app/(app)/swap/page.tsx');
  assert.match(create, /<LogoSelect/);
  assert.match(create, /symbols: \[asset\.symbol\]/);
  assert.match(create, /ADMITTED COUNTERASSET/);
  assert.match(create, /useState\(''\)/);
  assert.match(swap, /<LogoSelect/);
  assert.match(swap, /symbols: \[item\.legs\[0\]\.symbol, item\.legs\[1\]\.symbol\]/);
  assert.match(swap, /PRICE_GUARDED|SESSION_ONLY/);
});

test('landing connects live product routes and explains verified limits', async () => {
  const landing = await read('../components/landing/gyevo/sections.tsx');
  const closing = await read('../components/landing/gyevo/final-reveal.tsx');
  const copy = `${landing}\n${closing}`;
  for (const path of ['/pools', '/create', '/swap', '/positions', '/protocol']) assert.ok(copy.includes(path), `landing should link to ${path}`);
  assert.match(copy, /Chainlink.{0,100}(PRE|REGULAR|POST|OVERNIGHT)|PRE.{0,100}Chainlink/is);
  assert.match(copy, /120 seconds/i);
  assert.match(copy, /audit/i);
  assert.match(copy, /empty|no pool.{0,50}created/is);
  assert.match(copy, /illustrative|example/i);
});

test('Mainnet banner and protocol page separate ready wallet flows from missing liquidity', async () => {
  const banner = await read('../components/app/MainnetStatusBanner.tsx');
  const protocol = await read('../app/(app)/protocol/page.tsx');
  const shell = await read('../components/app/AppShell.tsx');
  const copy = `${banner}\n${protocol}\n${shell}`;
  assert.match(banner, /Chainlink/i);
  assert.match(copy, /No active Mainnet pool|pool directory is empty|no pools have been created|no Mainnet pool or swap exists/i);
  assert.match(protocol, /wallet.{0,40}position|position.{0,40}wallet/i);
  assert.match(shell, /Manage wallet positions|Manage LP positions/i);
  assert.doesNotMatch(copy, /asset admission.{0,35}unverified|pool creation remain unavailable|not wired in this frontend|Sample LP positions/i);
});

test('Mainnet banner reads live per-asset Chainlink session freshness from the Worker', async () => {
  const banner = await read('../components/app/MainnetStatusBanner.tsx');
  const status = await read('../components/app/MainnetSessionFeedStatus.tsx');
  assert.match(banner, /MainnetSessionFeedStatus/);
  assert.match(status, /MAINNET\.quoteUrl\.replace\(\/\\\/quote\$\/|\/status/);
  assert.match(status, /feedAgeSeconds/);
  assert.match(status, /sessionFeedFresh/);
  assert.match(status, /anchorValid/);
  assert.match(status, /last feed/);
  assert.match(status, /aria-live/);
});

test('quote and pool Worker reads are public, no-store and CORS enabled', async () => {
  const worker = await read('../../../workers/keeper-b/src/index.ts');
  assert.match(worker, /\['\/quote', '\/pools', '\/positions', '\/status'\]/);
  assert.match(worker, /access-control-allow-origin', '\*'/);
  assert.match(worker, /'cache-control': 'no-store'/);
  assert.match(worker, /BELL_POOL_FACTORY/);
  assert.match(worker, /toEventSelector\(POOL_CREATED_EVENT\)/);
  assert.match(worker, /runPositionCandidates/);
  assert.match(worker, /BELL_POSITION_MANAGER/);
});

test('pool creation is wired to the wallet, live Registry, approvals, factory simulation and receipt', async () => {
  const create = await read('../app/(app)/create/page.tsx');
  const flow = await read('../lib/mainnet-create-flow.ts');
  const helpers = await read('../lib/mainnet-create-helpers.mjs');
  const positions = await read('../app/(app)/positions/page.tsx');
  assert.match(create, /createMainnetPool\(/);
  assert.match(create, /Create and seed pool/);
  assert.doesNotMatch(create, /Create unavailable/);
  assert.match(flow, /applyPoolOracleUpdates/);
  assert.match(flow, /functionName: 'approve'/);
  assert.match(flow, /functionName: 'createAndSeed'/);
  assert.match(flow, /createPricePathForPhases/);
  assert.match(flow, /functionName: 'anchorStatus'/);
  assert.match(flow, /verified historical close reference/i);
  assert.match(flow, /Object\.entries\(queue\.counterassets/);
  assert.match(flow, /SESSION_ONLY/);
  assert.match(flow, /simulateContract/);
  assert.match(flow, /waitForTransactionReceipt/);
  assert.match(flow, /PoolCreated/);
  assert.match(flow, /ownerOf/);
  assert.match(helpers, /resolveAdmittedPair/);
  assert.match(helpers, /EXPECTED_HOOK_FLAGS = 0x2cc0n/);
  assert.doesNotMatch(create, /Illustrative|fake|sample price/i);
  assert.match(positions, /readLivePools\(\)/);
  assert.match(positions, /minimum0/);
  assert.match(positions, /amountMin: minimums\.map\(String\)/);
  assert.match(positions, /getPositionLiquidity/);
  assert.match(positions, /buildPublicLpTransaction/);
  assert.match(positions, /ownerOf/);
  assert.match(positions, /Remove in-kind/);
  assert.match(positions, /Collect fees/);
});

test('obsolete static create flow does not return', async () => {
  const create = await read('../app/(app)/create/page.tsx');
  const positions = await read('../app/(app)/positions/page.tsx');
  assert.doesNotMatch(create, /setTimeout\(\(\) => setDone\('ok'\)/);
  assert.match(positions, /readLivePools\(\)/);
  assert.match(positions, /waitForTransactionReceipt/);
  assert.match(positions, /No BELL positions in this wallet/);
});

test('legal and protocol pages resolve from the shared app navigation', async () => {
  for (const path of ['protocol', 'privacy', 'terms', 'cookies']) {
    assert.match(await read(`../app/(app)/${path}/page.tsx`), /export default/);
  }
});
