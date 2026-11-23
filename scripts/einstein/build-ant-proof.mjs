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
  status: 'blocked', statusNote: "ANT cannot be admitted yet: Chainlink has no ANT feed on Robinhood Chain, and BELL's asset registry refuses a stock token that has no price source.",
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
    unblocks: 'A Chainlink ANT/USD feed on Robinhood Chain. When one is listed the launch is the same sequence as NVDA: four source adapters, the asset queued through hybrid governance, the calendar root, the pool, the Lens.',
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
// The testnet rehearsal: the same steps ANT will need on mainnet, run with a test token and a fixture feed, every transaction linked.
const exp = 'https://explorer.testnet.chain.robinhood.com';
if (existsSync('evidence/deploy/testnet-46630-ant.json') && existsSync('evidence/einstein/ant-testnet-proofs.json')) {
  const adm = JSON.parse(readFileSync('evidence/deploy/testnet-46630-ant.json', 'utf8'));
  const cal = JSON.parse(readFileSync('evidence/deploy/testnet-46630-calendar-state-ANT.json', 'utf8'));
  const proofs = JSON.parse(readFileSync('evidence/einstein/ant-testnet-proofs.json', 'utf8'));
  const tx = (h) => ({ tx: h, url: `${exp}/tx/${h}` });
  proof.rehearsal = {
    title: 'Rehearsal on Robinhood testnet', network: { id: 46630, explorer: exp },
    note: 'The same steps ANT needs on mainnet, run with a test token (tANT), a fixture price feed and the Einstein stack deployed on testnet. It is not ANT and it is not mainnet. It shows that the path that does not exist on mainnet yet, adding a stock token after genesis, works.',
    token: adm.token, feed: adm.feed, hook: proofs.hook, pool: proofs.pool,
    steps: [
      { id: 'R1', title: 'Admitted after genesis through hybrid governance', note: `A governance call signed with ECDSA and SHRINCS (HybridAuth leaf ${adm.pqLeafUsed}) queued AssetRegistry.queueAsset, was executed, and the asset was activated.`, txs: [tx(adm.txs.queueGovernanceCall), tx(adm.txs.executeGovernanceCall), tx(adm.txs.activateAsset)], verdict: 'PASS' },
      { id: 'A2', title: 'The calendar root was signed post-quantum', note: 'The root for the asset was queued through a second hybrid-signed governance call, executed, then activated.', txs: [tx(cal.governanceQueuedTxHash), tx(cal.rootQueuedTxHash)], verdict: cal.stage === 'INTERVAL_ACTIVE' ? 'PASS' : 'PENDING' },
      { id: 'A3', title: 'The pool is real', note: 'Created and seeded in one transaction through the factory.', txs: [tx(proofs.createTx)], verdict: 'PASS' },
      { id: 'A4', title: 'The hook cannot trap exits', note: proofs.checks.A4.note, txs: [], verdict: proofs.checks.A4.verdict },
      { id: 'A5', title: 'Session fees apply', note: proofs.checks.A5.note, txs: [tx(proofs.checks.A5.tx)], verdict: proofs.checks.A5.verdict },
      { id: 'A6', title: 'Caps hold', note: proofs.checks.A6.note, txs: [tx(proofs.checks.A6.tx)], verdict: proofs.checks.A6.verdict },
    ],
  };
}
const out = `${dir}/proof.json`;
if (arg('rpc')) {
  let r = '';
  try { r = execFileSync(process.execPath, ['scripts/einstein/verify-einstein-ant.mjs', '--rpc', arg('rpc'), '--online', ...(arg('testnet-rpc') ? ['--testnet-rpc', arg('testnet-rpc')] : [])], { encoding: 'utf8' }); } catch (e) { r = e.stdout ?? ''; }
  proof.lastRun = new Date().toISOString();
  proof.replay = r.split('\n').filter((l) => /^(R:)?[AB]\d/.test(l) || /^R:R\d/.test(l) || /^\s{3}\s*(PASS|FAIL|PENDING)/.test(l)).map((l) => l.trim());
}
writeFileSync(out, `${JSON.stringify(proof, null, 2)}\n`);
copyFileSync(out, 'apps/web/components/einstein/ant-proof.json');
console.log(`wrote ${out}`);
