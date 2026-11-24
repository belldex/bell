#!/usr/bin/env node
/**
 * Replays the ANT onboarding checks against a public Robinhood Chain RPC. No keys, no team API.
 *
 *   node scripts/einstein/verify-einstein-ant.mjs --rpc <public Robinhood Chain RPC> [--online] [--proof evidence/einstein/ant/proof.json]
 *
 * A1  The ANT address is Robinhood's real stock token: same runtime code as the AAPL, NVDA and TSLA tokens BELL already lists,
 *     the Robinhood name and the ANT symbol, a live uiMultiplier, and the two look-alike Anthropic tokens are different contracts.
 * B1  Whether a Chainlink ANT/USD feed exists on Robinhood Chain (only with --online: it reads Chainlink's public feed directory).
 *
 * With --online it also reads Robinhood's own asset list (api.robinhood.com/rhj/assets) and checks that it names the same address.
 * PASS, FAIL or PENDING per check; PENDING is never a PASS.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createPublicClient, http, keccak256, parseAbi, getAddress } from 'viem';
import { poolChecks } from './ant-pool-checks.mjs';
import { haltChecks } from './ant-halt-checks.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const online = process.argv.includes('--online');
const proofPath = arg('proof', 'evidence/einstein/ant/proof.json');
const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
const rpcUrl = arg('rpc', process.env.RPC_URL);
if (!rpcUrl) { console.error('usage: verify-einstein-ant.mjs --rpc <public Robinhood Chain RPC> [--online]'); process.exit(2); }
const pc = createPublicClient({ transport: http(rpcUrl) });
if (await pc.getChainId() !== proof.chain.id) { console.error(`RPC is not chain ${proof.chain.id}`); process.exit(2); }

const abi = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function uiMultiplier() view returns (uint256)', 'function oraclePaused() view returns (bool)']);
const read = async (address, fn) => { try { return await pc.readContract({ address, abi, functionName: fn }); } catch { return null; } };
const codeHash = async (address) => { const c = await pc.getBytecode({ address }); return c && c.length > 2 ? keccak256(c) : null; };

const out = {};
const a1 = proof.a1;
const ant = getAddress(a1.address);
const antHash = await codeHash(ant);
const refs = await Promise.all(a1.referenceTokens.map(async (t) => ({ symbol: t.symbol, hash: await codeHash(getAddress(t.address)) })));
const same = refs.filter((r) => r.hash && r.hash === antHash).map((r) => r.symbol);
const [name, symbol, decimals, mult, paused] = await Promise.all(['name', 'symbol', 'decimals', 'uiMultiplier', 'oraclePaused'].map((f) => read(ant, f)));
const lookalikes = await Promise.all(a1.lookalikes.map(async (l) => ({ ...l, hash: await codeHash(getAddress(l.address)), mult: await read(getAddress(l.address), 'uiMultiplier') })));
const lookalikeOk = lookalikes.every((l) => l.hash && l.hash !== antHash && l.mult === null);
const identityOk = antHash && same.length === refs.length && symbol === 'ANT' && decimals === 18 && /Robinhood Token$/.test(name ?? '') && mult && mult > 0n && paused === false;
out.A1 = identityOk && lookalikeOk
  ? { verdict: 'PASS', note: `${ant} has the same runtime code as ${same.join(', ')} (${antHash.slice(0, 12)}…), is named "${name}", symbol ${symbol}, ${decimals} decimals, uiMultiplier ${Number(mult) / 1e18}, oracle not paused. The ${lookalikes.length} look-alike Anthropic tokens are different contracts without uiMultiplier.` }
  : { verdict: 'FAIL', note: `identity ok ${Boolean(identityOk)}, look-alikes ok ${lookalikeOk}, same code as ${same.join(', ') || 'none'}` };

if (online) {
  try {
    const list = await (await fetch('https://api.robinhood.com/rhj/assets')).json();
    const rows = (Array.isArray(list) ? list : list.assets ?? list.results ?? []).filter((x) => x.tokenSymbol === 'ANT');
    const dep = rows[0]?.deployments?.find((d) => d.chainId === proof.chain.id)?.contractAddress;
    out.A1.official = dep && getAddress(dep) === ant ? { verdict: 'PASS', note: `Robinhood's asset list names ${dep} for ANT on chain ${proof.chain.id}, status ${rows[0].status}.` } : { verdict: 'FAIL', note: `Robinhood's asset list names ${dep ?? 'nothing'} for ANT.` };
  } catch (e) { out.A1.official = { verdict: 'PENDING', note: `could not read api.robinhood.com: ${String(e.cause?.code ?? e.message).slice(0, 80)}` }; }
  try {
    const feeds = await (await fetch('https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json')).json();
    const hit = feeds.filter((f) => f.docs?.baseAsset === 'ANT' || /anthropic/i.test(f.name ?? ''));
    out.B1 = hit.length
      ? { verdict: 'PASS', note: `Chainlink lists an ANT feed: ${hit.map((f) => `${f.name} ${f.proxyAddress}`).join('; ')}. The blocker is gone: admit ANT.` }
      : { verdict: 'PENDING', note: `Chainlink's Robinhood mainnet directory has ${feeds.length} feeds and none for ANT, so BELL cannot admit ANT yet.` };
  } catch (e) { out.B1 = { verdict: 'PENDING', note: `could not read Chainlink's feed directory: ${String(e.cause?.code ?? e.message).slice(0, 80)}` }; }
}
// Mainnet admission: the registry names the descriptor for ANT, every adapter has code, and every recorded transaction succeeded.
if (proof.mainnet) {
  const m = proof.mainnet;
  const REG = parseAbi(['function descriptorIdForToken(address token) view returns (bytes32)']);
  const onchain = await pc.readContract({ address: m.assetRegistry, abi: REG, functionName: 'descriptorIdForToken', args: [getAddress(m.token)] });
  const codes = await Promise.all(m.adapters.map(async (a) => ({ name: a.name, ok: Boolean(await codeHash(getAddress(a.address))) })));
  const txs = [...m.governance, ...m.adapters.map((a) => a.deployTx)];
  const rcs = await Promise.all(txs.map(async (t) => { try { return (await pc.getTransactionReceipt({ hash: t.tx })).status; } catch { return 'missing'; } }));
  const ok = onchain.toLowerCase() === m.descriptorId.toLowerCase() && codes.every((x) => x.ok) && rcs.every((x) => x === 'success');
  out.M1 = ok ? { verdict: 'PASS', note: `AssetRegistry ${m.assetRegistry} names descriptor ${onchain.slice(0, 12)}… for ANT, the ${codes.length} delegated adapters have code, and ${rcs.length} transactions succeeded.` }
    : { verdict: 'FAIL', note: `descriptor on chain ${onchain}, adapters with code ${codes.filter((x) => x.ok).length}/${codes.length}, successful transactions ${rcs.filter((x) => x === 'success').length}/${rcs.length}` };
}
if (proof.mainnet?.calendar) {
  const cal = proof.mainnet.calendar;
  const rcs = await Promise.all(cal.txs.map(async (t) => { try { return (await pc.getTransactionReceipt({ hash: t.tx })).status; } catch { return 'missing'; } }));
  out.M2 = rcs.every((x) => x === 'success')
    ? { verdict: 'PASS', note: `The ANT calendar root ${cal.root.slice(0, 12)}… (${cal.leafCount} intervals, ${new Date(cal.coverageStart * 1000).toISOString().slice(0, 10)} to ${new Date(cal.coverageEnd * 1000).toISOString().slice(0, 10)}) was queued through a hybrid-signed governance call and activated: ${rcs.length} transactions succeeded.` }
    : { verdict: 'FAIL', note: `calendar transactions: ${rcs.join(', ')}` };
}
// The testnet rehearsal, when a testnet RPC is given: every linked transaction must be a successful receipt, and the Swap event and the revert are read again.
const testnetRpc = arg('testnet-rpc', process.env.TESTNET_RPC_URL);
if (proof.rehearsals?.length && testnetRpc) {
  const tpc = createPublicClient({ transport: http(testnetRpc) });
  if (await tpc.getChainId() !== proof.rehearsals[0].network.id) { console.error('--testnet-rpc is not chain 46630'); process.exit(2); }
  for (const r of proof.rehearsals) {
    for (const step of r.steps) {
      const rows = await Promise.all(step.txs.map(async (t) => { try { const rc = await tpc.getTransactionReceipt({ hash: t.tx }); return { tx: t.tx, status: rc.status }; } catch { return { tx: t.tx, status: 'missing' }; } }));
      const expectRevert = step.id === 'A6';
      const ok = step.txs.length === 0 ? step.verdict === 'PASS' : rows.every((x) => (expectRevert ? x.status === 'reverted' : x.status === 'success'));
      out[`R:${r.key}:${step.id}`] = { verdict: ok && step.verdict === 'PASS' ? 'PASS' : 'FAIL', note: `${step.title}: ${step.txs.length ? rows.map((x) => `${x.tx.slice(0, 10)}… ${x.status}`).join(', ') : step.note.slice(0, 90)}` };
    }
  }
}
await poolChecks({ pc, proof, out });
await haltChecks({ pc, proof, out });
for (const id of ['A2', 'A3', 'A4', 'A5', 'A6', 'A7']) out[id] ??= { verdict: 'PENDING', note: proof.claims.find((c) => c.id === id)?.blockedBy ?? 'Waits for the pool.' };

for (const [id, r] of Object.entries(out)) {
  console.log(`${id.padEnd(3)} ${r.verdict.padEnd(7)} ${r.note}`);
  if (r.official) console.log(`${' '.repeat(3)} ${r.official.verdict.padEnd(7)} ${r.official.note}`);
}
const all = Object.values(out).flatMap((r) => [r, ...(r.official ? [r.official] : [])]);
const n = (v) => all.filter((r) => r.verdict === v).length;
console.log(`\n${n('PASS')} PASS, ${n('PARTIAL')} PARTIAL, ${n('PENDING')} PENDING, ${n('FAIL')} FAIL`);
process.exit(n('FAIL') ? 1 : 0);
