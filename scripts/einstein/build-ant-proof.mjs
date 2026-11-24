#!/usr/bin/env node
/**
 * Builds evidence/einstein/ant/proof.json, the only file the /einstein/ant page reads. The identity facts are read from chain and
 * the replay script checks them again; the sources are recorded with the date they were read. Nothing about the pool is claimed until
 * a pool exists: A2 to A7 stay PENDING, with the reason, until then.
 *
 *   node scripts/einstein/build-ant-proof.mjs                 build from the facts in this file, no network
 *   node scripts/einstein/build-ant-proof.mjs --rpc <url>     also replay A1 and record the verdicts
 */
import { writeFileSync, copyFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const dir = 'evidence/einstein/ant';
mkdirSync(dir, { recursive: true });
const retrievedAt = '2026-11-23';
const proof = {
  title: 'ANT on BELL', subtitle: "Robinhood's Anthropic stock token, onboarded step by step. Nothing here is live until it says so.",
  chain: { id: 4663, name: 'Robinhood Chain', explorer: 'https://robinhoodchain.blockscout.com' },
  status: 'blocked', statusNote: "ANT is not live on mainnet yet. Chainlink has no ANT feed, and BELL's asset registry refuses a stock token without a price source, so BELL built its own: a delegated-attestation source, rehearsed end to end on testnet below. The mainnet steps are next.",
  a1: {
    address: '0xbbB6c29bCc3a1028A2B54310DF73F4F7A3bcB373',
    referenceTokens: [
      { symbol: 'AAPL', address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9' },
      { symbol: 'NVDA', address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC' },
      { symbol: 'TSLA', address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d' },
    ],
    lookalikes: [
      { name: 'Anthropic (meme token, ANT)', address: '0x36c2861a1f94c6f277a388338a4f8a686e0d9b30' },
      { name: 'ANTHROPIC • Pre IPO Token', address: '0x4eb576e9c8a24b5fb11dd8eee5e5e2554ade1cf4' },
    ],
    sources: [
      { label: 'Robinhood Chain token contracts (generated from the on-chain asset registry)', url: 'https://docs.robinhood.com/chain/contracts', retrievedAt, says: 'Anthropic, PBC Class A Common Stock • Robinhood Token, ANT, 0xbbB6c29bCc3a1028A2B54310DF73F4F7A3bcB373' },
      { label: 'Robinhood asset list API', url: 'https://api.robinhood.com/rhj/assets', retrievedAt, says: 'ANT, chain 4663, ASSET_STATUS_ACTIVE, tradable in market, extended and overnight sessions, ISIN US03703U1079' },
    ],
  },
  blocker: {
    id: 'B1', title: 'There is no price source for ANT',
    what: "Chainlink's Robinhood mainnet feed directory lists 62 feeds and none is ANT. Robinhood's docs say feeds exist only for a selected subset of Stock Tokens.",
    why: [
      "BELL's AssetRegistry refuses a stock token without a price adapter and session sources (ERR_STOCK_ADAPTERS, ERR_TOKEN_SOURCE_MISSING). A market-price mode, where the pool prices from its own liquidity, is not something the deployed contracts allow for admission.",
      'A BELL-attested price would need a post-quantum signed report on every update, because each report spends one HybridAuth leaf. Reports must be at most 60 to 300 seconds old depending on the session, so a 4,096-leaf REPORTER key would last roughly three to six days of continuous quoting.',
    ],
    unblocks: 'Two ways. A Chainlink ANT/USD feed on Robinhood Chain, if one is listed. Or the delegated-attestation source below, which needs no feed.',
    solution: {
      title: 'The way around it: one post-quantum signature a day, a delegate key per report',
      points: [
        'One hybrid-signed call (ECDSA and SHRINCS, one leaf per adapter) names a delegate key that may sign for at most a day and an hour. The delegate signs each report with ECDSA only. Four adapters means four leaves a day, so a 4,096-leaf REPORTER key lasts about two and a half years.',
        "The price is read from Robinhood's own REST pricing API (tokenBid and tokenAsk, already adjusted for the corporate-action multiplier). A report is not published when the API says the asset is halted, when the spread is wider than 2 percent, or when the quote is older than a minute.",
        "What it costs in trust, plainly: inside a delegation window one ECDSA key can publish prices, and BELL is the oracle for ANT. Limits: a report may move the price at most 3 percent from the last one (25 percent after a quiet gap, anything larger needs a hybrid-signed rebase), the delegation expires by itself and can be revoked with a hybrid-signed call, and the delegate cannot touch the token's corporate-action status, which the registry reads from the token.",
        'The pool is SESSION_ONLY, so the price never sets a swap price; it feeds the health checks and the closing anchors. If Chainlink lists an ANT feed later, the source can be replaced.',
      ],
      contract: 'contracts/src/adapters/DelegatedAttestedSourceAdapter.sol',
      tests: '14 forge tests, including: no report before a delegate exists, one leaf for twenty reports, a foreign key refused, a post-quantum field on a report refused, expiry, rotation and revoke, the step bands and rebase.',
    },
    sources: [
      { label: 'Chainlink feed directory for Robinhood mainnet', url: 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json', retrievedAt },
      { label: 'Robinhood: oracles and price feeds', url: 'https://docs.robinhood.com/chain/oracles-and-price-feeds', retrievedAt },
    ],
  },
  claims: [
    { id: 'A1', title: "BELL lists Robinhood's real ANT", proof: "The address from Robinhood's registry and asset API, with the same runtime code as AAPL, NVDA and TSLA.", passes: "Same code hash as the three listed tokens, the Robinhood name, symbol ANT, and Robinhood's own list names the same address." },
    { id: 'A2', title: 'The ANT calendar was signed post-quantum', proof: 'HybridAuth submit tx and the REPORTER leaf counter before and after.', passes: 'Tx succeeds with ECDSA and SHRINCS and the leaf counter goes up by one.', blockedBy: 'Needs the asset admitted first, which needs a price source (B1).' },
    { id: 'A3', title: 'The pool is real', proof: 'Initialize and seed transaction, position id.', passes: 'Pool id matches, hook is the ANT Einstein hook, liquidity above zero.', blockedBy: 'Needs the asset admitted (B1) and a seed.' },
    { id: 'A4', title: 'The hook cannot trap exits', proof: 'The hook address decoded.', passes: 'Low 14 bits are 0x2cc0, and the remove-liquidity bits 9, 8 and 0 are off.', blockedBy: 'Needs the ANT hook to be deployed.' },
    { id: 'A5', title: 'Session fees apply', proof: 'One swap per session as they occur, fee read from the Swap event.', passes: 'Fee equals 500, 3000, 5000 or 10000 pips for that session.', blockedBy: 'Needs the pool.' },
    { id: 'A6', title: 'Caps hold', proof: 'One reverted swap above the cap.', passes: 'It reverts with TradeCapExceeded.', blockedBy: 'Needs the pool.' },
    { id: 'A7', title: 'The code is verifiable', proof: 'Sourcify for the hook and the Lens.', passes: 'Exact match for both.', blockedBy: 'Needs the contracts. The factory builds hooks without a metadata hash, so the hook can only reach match, not exact match.' },
  ],
  compliance: [
    'ANT is a tokenized debt security issued by Robinhood Assets (Jersey) Limited. It is not Anthropic equity and gives no shareholder rights.',
    'It may not be offered, sold or delivered in the United States or to U.S. persons.',
    "BELL is not affiliated with Robinhood or Anthropic. This page does not use Anthropic's logo or brand marks.",
  ],
  limits: [
    'Only the ANT contract that Robinhood lists is considered. ANTc (Coinbase, Base) and ANTon (Ondo, Ethereum and BNB Chain) are on chains where BELL is not deployed, and bridging them would create a new token with its own risk.',
    "A1 shows the token is Robinhood's. It says nothing about whether ANT is a good asset to hold or trade.",
    'No independent cryptographic review of the post-quantum stack exists yet.',
  ],
};
// Testnet rehearsals: the same steps ANT needs on mainnet, run with a test token, every transaction linked. Two of them: one with a
// Chainlink-shaped fixture feed, one with the delegated-attestation price source, which is what ANT has to use because no feed exists.
const exp = 'https://explorer.testnet.chain.robinhood.com';
const tx = (h) => ({ tx: h, url: `${exp}/tx/${h}` });
const j = (f) => JSON.parse(readFileSync(f, 'utf8'));
function rehearsal(key, title, note, adm, cal, proofs, extraSteps) {
  return {
    key, title, network: { id: 46630, explorer: exp }, note, token: adm.token, feed: adm.feed ?? null, hook: proofs.hook, pool: proofs.pool,
    steps: [
      { id: 'R1', title: 'Admitted after genesis through hybrid governance', note: `A governance call signed with ECDSA and SHRINCS (HybridAuth leaf ${adm.pqLeafUsed}) queued AssetRegistry.queueAsset, was executed, and the asset was activated.`, txs: [tx(adm.txs.queueGovernanceCall), tx(adm.txs.executeGovernanceCall), tx(adm.txs.activateAsset)], verdict: 'PASS' },
      ...extraSteps,
      { id: 'A2', title: 'The calendar root was signed post-quantum', note: 'The root for the asset was queued through a second hybrid-signed governance call, executed, then activated.', txs: [tx(cal.governanceQueuedTxHash), tx(cal.rootQueuedTxHash)], verdict: cal.stage === 'INTERVAL_ACTIVE' ? 'PASS' : 'PENDING' },
      { id: 'A3', title: 'The pool is real', note: 'Created and seeded in one transaction through the factory.', txs: [tx(proofs.createTx)], verdict: 'PASS' },
      { id: 'A4', title: 'The hook cannot trap exits', note: proofs.checks.A4.note, txs: [], verdict: proofs.checks.A4.verdict },
      { id: 'A5', title: 'Session fees apply', note: proofs.checks.A5.note, txs: [tx(proofs.checks.A5.tx)], verdict: proofs.checks.A5.verdict },
      { id: 'A6', title: 'Caps hold', note: proofs.checks.A6.note, txs: [tx(proofs.checks.A6.tx)], verdict: proofs.checks.A6.verdict },
    ],
  };
}
proof.rehearsals = [];
if (existsSync('evidence/deploy/testnet-46630-ant.json') && existsSync('evidence/einstein/ant-testnet-proofs.json')) {
  proof.rehearsals.push(rehearsal('fixture', 'Rehearsal 1: a fixture feed',
    'The path with a Chainlink-shaped fixture feed. It shows adding a stock token after genesis works, which no mainnet transaction has done yet. Test token, not ANT, not mainnet.',
    j('evidence/deploy/testnet-46630-ant.json'), j('evidence/deploy/testnet-46630-calendar-state-ANT.json'), j('evidence/einstein/ant-testnet-proofs.json'), []));
}
if (existsSync('evidence/deploy/testnet-46630-ant-delegated.json') && existsSync('evidence/einstein/ant-testnet-proofs-delegated.json')) {
  const adm = j('evidence/deploy/testnet-46630-ant-delegated.json');
  const published = readFileSync('evidence/einstein/ant-publish.out.log', 'utf8').split('\n').map((l) => l.match(/published (\d+) USD, reasons (\d+), tx (0x[0-9a-f]{64})/)).filter(Boolean)[0];
  proof.rehearsals.push(rehearsal('delegated', 'Rehearsal 2: no feed, a delegated price source',
    'The situation ANT is in: no Chainlink feed. The price source is the delegated-attestation adapter: one post-quantum signature authorizes a delegate key for a day, and the delegate signs each report with ECDSA only. Test token, not ANT, not mainnet.',
    adm, j('evidence/deploy/testnet-46630-calendar-state-delegated-ANT.json'), j('evidence/einstein/ant-testnet-proofs-delegated.json'),
    [
      { id: 'D1', title: 'The delegate was authorized with one post-quantum signature per adapter', note: `Four adapters, one hybrid-signed call each (REPORTER leaves ${adm.delegations.map((d) => d.leaf).join(', ')}). After that the delegate signs reports with ECDSA only and spends no more leaves.`, txs: adm.delegations.map((d) => tx(d.tx)), verdict: adm.delegations.length === 4 ? 'PASS' : 'PENDING' },
      ...(published ? [{ id: 'D2', title: 'A delegate-signed report was accepted and the asset read healthy', note: `A direct price and a session report signed by the delegate were submitted to the SessionRegistry. Health reason bits after the report: ${published[2]}.`, txs: [tx(published[3])], verdict: published[2] === '0' ? 'PASS' : 'FAIL' }] : []),
    ]));
}
// Mainnet: the asset admission is a fact on chain once the evidence file has a descriptor id.
if (existsSync('evidence/deploy/mainnet-4663-ant.json')) {
  const m = j('evidence/deploy/mainnet-4663-ant.json');
  const pqm = j('evidence/deploy/pq-hooks-mainnet.json');
  if (m.admittedDescriptorId) {
    const mtx = (h) => ({ tx: h, url: `${proof.chain.explorer}/tx/${h}` });
    proof.mainnet = {
      title: 'Admitted on mainnet', assetRegistry: pqm.contracts.assetRegistry, token: m.token, descriptorId: m.admittedDescriptorId,
      adapters: Object.entries(m.adapters).map(([name, address]) => ({ name, address, deployTx: mtx(m.txs[name]) })),
      governance: [mtx(m.txs.queueGovernanceCall), mtx(m.txs.executeGovernanceCall), mtx(m.txs.activateAsset)],
      pqLeafUsed: m.pqLeafUsed,
      note: `Four delegated-attestation adapters were deployed against Robinhood's ANT and the asset was admitted through a governance call signed with ECDSA and SHRINCS (HybridAuth leaf ${m.pqLeafUsed}). No pool exists yet. The delegate that signs prices has not been authorized yet, so no price can be published.`,
    };
    if (existsSync('evidence/deploy/pq-hooks-mainnet-calendar-state-ANT.json')) {
      const cal = j('evidence/deploy/pq-hooks-mainnet-calendar-state-ANT.json');
      if (cal.stage === 'INTERVAL_ACTIVE') {
        proof.mainnet.calendar = { root: cal.root, coverageStart: cal.coverageStart, coverageEnd: cal.coverageEnd, leafCount: cal.leafCount, txs: [mtx(cal.governanceQueuedTxHash), mtx(cal.rootQueuedTxHash)] };
        proof.mainnet.note += ' The calendar root for ANT was signed with ECDSA and SHRINCS and activated, so the first session interval is active.';
      }
    }
    proof.status = 'admitted';
    proof.statusNote = 'ANT is admitted on BELL mainnet with a delegated price source. There is no pool yet and no delegate is authorized, so nothing trades and no price is published.';
  }
}
// Mainnet pool: the pool exists once the creation record is there. The checks A2 to A7 are replayed from chain by ant-pool-checks.mjs.
const poolFiles = existsSync('evidence/einstein') ? readdirSync('evidence/einstein').filter((f) => /^ant-pool-\d+\.json$/.test(f)).sort() : [];
if (poolFiles.length && existsSync('evidence/deploy/halt-stack-4663.json') && proof.mainnet) {
  const rec = j(`evidence/einstein/${poolFiles.at(-1)}`);
  const halt = j('evidence/deploy/halt-stack-4663.json');
  const lens = existsSync('evidence/einstein/lens-ant.json') ? j('evidence/einstein/lens-ant.json') : null;
  const swaps = existsSync('evidence/einstein/ant-mainnet-swaps.json') ? j('evidence/einstein/ant-mainnet-swaps.json') : { swaps: [], a6: null };
  const mtx = (h) => ({ tx: h, url: `${proof.chain.explorer}/tx/${h}` });
  proof.pool = {
    chainId: 4663, poolId: rec.poolId, hook: rec.hook, factory: halt.contracts.poolFactory, poolManager: halt.reused.poolManager,
    calendarRegistry: j('evidence/deploy/pq-hooks-mainnet.json').contracts.calendarRegistry, createTx: rec.txs.createAndSeed, block: rec.block, lens: lens?.lens ?? null,
    seed: { usdg: rec.request.seedUsdg, openingPriceUsd: rec.request.nvdaUsd },
    swaps: swaps.swaps, a6: swaps.a6,
    links: { create: mtx(rec.txs.createAndSeed), lens: lens ? mtx(lens.tx) : null, swaps: swaps.swaps.map((s) => mtx(s.tx)), a6: swaps.a6 ? mtx(swaps.a6.tx) : null },
  };
  proof.mainnet.note = `Four delegated-attestation adapters were deployed against Robinhood's ANT and the asset was admitted through a governance call signed with ECDSA and SHRINCS (HybridAuth leaf ${proof.mainnet.pqLeafUsed}). The delegate key that signs each swap's price report is authorized for 25 hours at a time with one hybrid-signed call per adapter, renewed automatically by a scheduled workflow. The calendar root for ANT was signed with ECDSA and SHRINCS and is activated session by session.`;
  proof.status = 'live';
  proof.statusNote = `ANT/USDG is live on BELL mainnet. Pool ${rec.poolId}, created in block ${rec.block} through the Einstein Hooks v3 factory with a ${rec.request.seedUsdg} USDG seed, which is small: the per-trade cap is about 0.24 USDG. BELL attests the price (Chainlink has no ANT feed): each swap carries a price report signed by a delegate key, so the pool refuses a swap when no fresh report is available.`;
  proof.blocker.title = 'ANT has no Chainlink feed, so BELL attests the price';
  proof.blocker.unblocks = 'Solved with the delegated-attestation source below, live on mainnet. If Chainlink lists an ANT feed later, the source can be replaced.';
  for (const c of proof.claims) delete c.blockedBy;
}
const out = `${dir}/proof.json`;
writeFileSync(out, `${JSON.stringify(proof, null, 2)}
`); // the replay below reads this file, so it must be the new one
if (arg('rpc')) {
  let r = '';
  try { r = execFileSync(process.execPath, ['scripts/einstein/verify-einstein-ant.mjs', '--rpc', arg('rpc'), '--online', ...(arg('testnet-rpc') ? ['--testnet-rpc', arg('testnet-rpc')] : [])], { encoding: 'utf8' }); } catch (e) { r = e.stdout ?? ''; }
  proof.lastRun = new Date().toISOString();
  proof.replay = r.split('\n').filter((l) => /^[ABM]\d/.test(l) || /^R:/.test(l) || /^\s{3}\s*(PASS|FAIL|PENDING)/.test(l)).map((l) => l.trim());
}
writeFileSync(out, `${JSON.stringify(proof, null, 2)}\n`);
copyFileSync(out, 'apps/web/components/einstein/ant-proof.json');
console.log(`wrote ${out}`);
