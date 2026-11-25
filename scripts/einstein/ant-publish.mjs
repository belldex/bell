#!/usr/bin/env node
/**
 * Publishes ANT price reports through the delegated-attestation adapters.
 *
 *   authorize  one hybrid-signed call per adapter (ECDSA by the REPORTER key, SHRINCS by the REPORTER signer state) names the delegate key and
 *              how long it may sign. This is the only post-quantum signature in the loop: one leaf per adapter per delegation.
 *   publish    signs a direct price sample and one session report with the delegate key (ECDSA only) and submits them with
 *              SessionRegistry.refreshStockWithReports. Run it every 45 seconds while a session is open.
 *   loop       publish forever
 *
 *   node scripts/einstein/ant-publish.mjs authorize --state evidence/deploy/testnet-46630-ant-delegated.json --hours 24 --broadcast
 *   node scripts/einstein/ant-publish.mjs publish   --state evidence/deploy/testnet-46630-ant-delegated.json --price 300
 *   node scripts/einstein/ant-publish.mjs loop      --state evidence/deploy/testnet-46630-ant-delegated.json --price 300
 *
 * Testnet only for now: the price is the --price argument. On mainnet the price comes from an official source read by the publisher (not from a
 * hand-typed number), and the same state file shape points at the mainnet stack.
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseAbi, parseAbiParameters, parseEther, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sessionIntervals, sessionAt } from './v3-evolve/lib.mjs';

const command = process.argv[2] ?? 'publish';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const broadcast = process.argv.includes('--broadcast');
const env = {};
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); } } catch { /* no .env: CI passes everything through the environment */ }
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
const acct = (n) => privateKeyToAccount(env[n].startsWith('0x') ? env[n] : `0x${env[n]}`);
const state = JSON.parse(readFileSync(arg('state'), 'utf8'));
const MAINNET = arg('network', 'testnet') === 'mainnet';
const manifest = JSON.parse(readFileSync(MAINNET ? 'evidence/deploy/pq-hooks-mainnet.json' : 'evidence/deploy/pq-hooks-testnet-46630.json', 'utf8'));
const c = manifest.contracts;
const rpc = MAINNET ? env.RH_MAINNET_RPC_PRIMARY : env.RH_TESTNET_RPC_PRIMARY;
const pc = createPublicClient({ transport: http(rpc) });
const sender = acct(env.ANT_SENDER_PRIVATE_KEY ? 'ANT_SENDER_PRIVATE_KEY' : MAINNET && env.RH_MAINNET_DEPLOYER_PRIVATE_KEY ? 'RH_MAINNET_DEPLOYER_PRIVATE_KEY' : 'DEPLOYER_PRIVATE_KEY'); // any wallet can submit; it only pays gas
const wc = createWalletClient({ account: sender, transport: http(rpc) });
const delegate = acct('ANT_DELEGATE_PRIVATE_KEY');
const REPORTER = keccak256(stringToHex('REPORTER'));
const NAMES = ['tokenPriceAdapter', 'regularAdapter', 'extendedAdapter', 'overnightAdapter'];

const ADAPTER = parseAbi([
  'function authorizeDelegate(address newDelegate,uint64 validUntil,uint256 deadline,bytes ecdsaSignature,bytes pqSignature)',
  'function reportDigest(bytes32 payloadHash,uint256 deadline) view returns (bytes32)',
  'function delegate() view returns (address)', 'function delegateUntil() view returns (uint64)',
]);
const AUTH = parseAbi(['function nonce(bytes32 role) view returns (uint256)', 'function registry() view returns (address)', 'function actionDigest(bytes32 role,address target,bytes32 action,bytes32 payloadHash,uint256 actionNonce,uint32 keyVersion,uint256 deadline) view returns (bytes32)']);
const KEYS = parseAbi(['function roleKey(bytes32 role) view returns ((address ecdsaSigner,bytes32 publicKeyCommitment,uint32 maxStatefulSignatures,uint32 nextStatefulLeaf,uint32 keyVersion,bool installed))']);
const SESSION = parseAbi(['function refreshStockWithReports(bytes32 assetId,(bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash) directSample,bytes directSignature,bytes[] reports) returns (uint256 reasons)']);
const SAMPLE = '(bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash)';
const DELEGATE_ACTION = keccak256(stringToHex('BELL_SOURCE_DELEGATE_V1'));
const PHASE = { PRE: 1, REGULAR: 2, POST: 3, OVERNIGHT: 4 };
const SCOPE_OF = { REGULAR: 1, PRE: 2, POST: 2, OVERNIGHT: 3 }; // which adapter carries the session report

const pq = (cmd, digest, leaf) => {
  const r = spawnSync(process.execPath, ['contracts/pq/signer/signer.mjs', cmd, 'reporter', digest], { encoding: 'utf8', env: { ...process.env, BELL_PQ_KEY_PROFILE: MAINNET ? 'robinhood-4663' : 'robinhood-46630' } });
  if (r.status !== 0) throw new Error(`pq ${cmd} failed: ${r.stderr.trim()}`);
  const out = JSON.parse(r.stdout);
  if (Number(out.leafIndex) !== Number(leaf)) throw new Error(`local reporter signer at leaf ${out.leafIndex}, chain expects ${leaf}`);
  return out.signature;
};
const wait = async (hash, what) => { const r = await pc.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw new Error(`${what} failed ${hash}`); return r; };

async function authorize() {
  const hours = Number(arg('hours', '24'));
  const reporter = acct('YAHOO_REPORTER_PRIVATE_KEY'); // the REPORTER role's ECDSA signer
  const auth = c.hybridAuth; const registry = await pc.readContract({ address: auth, abi: AUTH, functionName: 'registry' });
  console.log(`delegate ${delegate.address}, valid ${hours} h, ${NAMES.length} adapters`);
  for (const name of NAMES) {
    const adapter = state.adapters[name];
    const current = await pc.readContract({ address: adapter, abi: ADAPTER, functionName: 'delegateUntil' });
    const nowTs = Number((await pc.getBlock()).timestamp);
    const validUntil = BigInt(nowTs + Math.floor(hours * 3600));
    const [nonce, key, epoch] = await Promise.all([pc.readContract({ address: auth, abi: AUTH, functionName: 'nonce', args: [REPORTER] }), pc.readContract({ address: registry, abi: KEYS, functionName: 'roleKey', args: [REPORTER] }), pc.readContract({ address: adapter, abi: parseAbi(['function delegateEpoch() view returns (uint64)']), functionName: 'delegateEpoch' })]);
    const payloadHash = keccak256(encodeAbiParameters(parseAbiParameters('address adapter,address delegate,uint64 validUntil,uint64 epoch'), [adapter, delegate.address, validUntil, epoch + 1n]));
    const deadline = BigInt(nowTs + 3600);
    const digest = await pc.readContract({ address: auth, abi: AUTH, functionName: 'actionDigest', args: [REPORTER, adapter, DELEGATE_ACTION, payloadHash, nonce, key.keyVersion, deadline] });
    const ecdsa = await reporter.sign({ hash: digest });
    const preview = pq('preview', digest, key.nextStatefulLeaf);
    await pc.simulateContract({ address: adapter, abi: ADAPTER, functionName: 'authorizeDelegate', args: [delegate.address, validUntil, deadline, ecdsa, preview], account: sender });
    if (!broadcast) { console.log(`${name}: simulation passed (leaf ${key.nextStatefulLeaf}), not sent`); continue; }
    // Signing spends a one-time leaf for good. If the transaction then cannot be sent (an empty sender wallet failed a run this way and left the
    // local signer one leaf ahead of the chain), that leaf is lost and the role key has to be rotated. So the sender's balance is checked first.
    const gasPrice = await pc.getGasPrice();
    const needed = 4_000_000n * gasPrice * 2n;
    const have = await pc.getBalance({ address: sender.address });
    if (have < needed) throw new Error(`the sender ${sender.address} holds ${have} wei and needs about ${needed}: refusing to spend a post-quantum leaf on a transaction that cannot be sent`);
    const sig = pq('sign', digest, key.nextStatefulLeaf);
    const hash = await wc.writeContract({ address: adapter, abi: ADAPTER, functionName: 'authorizeDelegate', args: [delegate.address, validUntil, deadline, ecdsa, sig], gas: 4_000_000n });
    await wait(hash, `authorize ${name}`);
    console.log(`${name}: delegate authorized with reporter leaf ${key.nextStatefulLeaf}, tx ${hash}`);
    (state.delegations ??= []).push({ adapter: name, tx: hash, leaf: key.nextStatefulLeaf, validUntil: String(validUntil) });
  }
  if (broadcast) appendFileSync(arg('state'), ''); // state is rewritten below by the caller
  return state;
}

/** The price comes from Robinhood's own REST pricing API (tokenBid and tokenAsk are already multiplier-adjusted). --price overrides it on testnet only. */
async function readPrice() {
  if (arg('price')) { if (MAINNET) throw new Error('mainnet reads the official source; --price is for testnet'); return Number(arg('price')); }
  const r = await fetch(`https://api.robinhood.com/rhj/prices/${arg('symbol', 'ANT')}`);
  if (!r.ok) throw new Error(`pricing API answered ${r.status}`);
  const q = (await r.json()).quotes?.[0];
  if (!q) throw new Error('pricing API returned no quote');
  if (q.isTradingHalt) throw new Error('the pricing API says the asset is halted: no report is published');
  const bid = Number(q.tokenBid); const ask = Number(q.tokenAsk);
  if (!(bid > 0 && ask >= bid)) throw new Error('bad bid/ask');
  if ((ask - bid) / ((ask + bid) / 2) > 0.02) throw new Error(`spread ${(((ask - bid) / bid) * 100).toFixed(2)} percent is wider than 2 percent: no report is published`);
  if (Date.now() - Date.parse(q.generatedAt) > 60_000) throw new Error('the quote is older than 60 seconds');
  return (bid + ask) / 2;
}

/** A pool is only swappable inside an activated calendar interval, and each interval is activated by a plain call. This runs the calendar script's
 *  activate-interval, which does nothing when the current interval is still active, so the publisher doubles as the interval keeper for ANT. */
function ensureInterval() {
  if (!broadcast) return;
  const r = spawnSync(process.execPath, ['scripts/deploy/testnet-einstein-calendar.mjs', 'activate-interval', '--asset=ANT', '--broadcast', '--i-authorize-spend'], {
    encoding: 'utf8',
    env: { ...process.env, EINSTEIN_NETWORK: MAINNET ? 'mainnet' : 'testnet', ANT_STATE: arg('state'), BELL_CALENDAR_DAYS: '60', BELL_CALENDAR_STATE_PREFIX: MAINNET ? 'evidence/deploy/pq-hooks-mainnet-calendar-state' : arg('calendar-prefix', 'evidence/deploy/testnet-46630-calendar-state-delegated') },
  });
  const line = (r.stdout || r.stderr || '').trim().split('\n').at(-1) ?? '';
  if (/Interval active|already active/.test(line) && /Interval active/.test(line)) console.log(`calendar: ${line}`);
  else if (r.status !== 0) console.error(`calendar: ${line.slice(0, 160)}`);
}

async function publish() {
  ensureInterval();
  const price = await readPrice();
  const now = Number((await pc.getBlock()).timestamp);
  const session = sessionAt(now, sessionIntervals(now - 86400, now + 86400));
  if (!(session in PHASE)) { console.log(`${session}: no session report to publish`); return; }
  const price18 = BigInt(Math.round(price * 1e6)) * 10n ** 12n;
  const mk = (feedId, phase, tag) => ({ descriptorId: `0x${'0'.repeat(64)}`, feedId, phase, price18, observedAt: BigInt(now - 3), inputAt: BigInt(now - 3), validFrom: BigInt(now - 3), expiresAt: BigInt(now + 100), validUntil: BigInt(now + 100), reportHash: keccak256(stringToHex(`${tag}:${price18}:${now}`)) });
  const deadline = BigInt(now + 110);
  const signFor = async (adapter, sample) => {
    const payload = keccak256(encodeAbiParameters(parseAbiParameters(`address adapter, ${SAMPLE} sample`), [adapter, sample]));
    const digest = await pc.readContract({ address: adapter, abi: ADAPTER, functionName: 'reportDigest', args: [payload, deadline] });
    return delegate.sign({ hash: digest });
  };
  const zero = `0x${'0'.repeat(64)}`;
  const direct = mk(zero, 0, 'direct');
  const directSig = await signFor(state.adapters.tokenPriceAdapter, direct);
  const directEnvelope = encodeAbiParameters(parseAbiParameters('uint256 deadline, bytes ecdsa, bytes pq'), [deadline, directSig, '0x']);
  const scope = SCOPE_OF[session]; const adapterName = NAMES[scope]; const wire = state.wires[scope];
  const stream = mk(wire.feedId, PHASE[session], `stream${scope}`);
  const streamSig = await signFor(state.adapters[adapterName], stream);
  const report = encodeAbiParameters(parseAbiParameters(`${SAMPLE} sample, uint256 deadline, bytes ecdsa, bytes pq`), [stream, deadline, streamSig, '0x']);
  const args = [state.admittedDescriptorId, direct, directEnvelope, [report]];
  const sim = await pc.simulateContract({ address: c.sessionRegistry, abi: SESSION, functionName: 'refreshStockWithReports', args, account: sender });
  if (!broadcast) { console.log(`${session}: simulation passed, health reasons ${sim.result}; not sent`); return; }
  const hash = await wc.writeContract({ ...sim.request, gas: 3_000_000n });
  await wait(hash, 'refreshStockWithReports');
  console.log(`${session}: published ${price} USD, reasons ${sim.result}, tx ${hash}`);
}

/** Renews the delegation only when it is about to lapse: reads every adapter's delegateUntil and does nothing (no PQ signature, no gas) while the
 *  shortest one still has more than --below hours (default 6). With --force it renews regardless. Meant to run from a scheduler every few hours. */
async function renewIfNeeded() {
  const below = Number(arg('below', '6')) * 3600;
  const now = Number((await pc.getBlock()).timestamp);
  const rows = await Promise.all(NAMES.map(async (name) => {
    const a = state.adapters[name];
    const [until, current] = await Promise.all([pc.readContract({ address: a, abi: ADAPTER, functionName: 'delegateUntil' }), pc.readContract({ address: a, abi: ADAPTER, functionName: 'delegate' })]);
    return { name, remaining: Number(until) - now, isOurs: current.toLowerCase() === delegate.address.toLowerCase() };
  }));
  const min = Math.min(...rows.map((r) => r.remaining));
  console.log(`delegation remaining: ${rows.map((r) => `${r.name} ${(r.remaining / 3600).toFixed(1)} h${r.isOurs ? '' : ' (other delegate)'}`).join(', ')}`);
  if (process.argv.includes('--force') || min <= below || rows.some((r) => !r.isOurs)) { console.log('renewing'); await authorize(); }
  else console.log(`still valid for more than ${below / 3600} h: nothing to do`);
}

if (command === 'authorize') { const st = await authorize(); if (broadcast && !process.argv.includes('--no-state')) (await import('node:fs')).writeFileSync(arg('state'), `${JSON.stringify(st, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`); }
else if (command === 'renew') await renewIfNeeded();
else if (command === 'publish') await publish();
else if (command === 'loop') { for (;;) { try { await publish(); } catch (e) { console.error('publish failed', String(e.shortMessage ?? e).slice(0, 200)); } await new Promise((r) => setTimeout(r, 45_000)); } }
else throw new Error('usage: ant-publish.mjs authorize|renew|publish|loop --state <file> [--price <usd>] [--hours 24] [--broadcast]');
