#!/usr/bin/env node
/**
 * Replays the Einstein Hooks v2 proof package against a public RPC. No keys, no team API, no dependencies.
 *
 *   node scripts/einstein/verify-einstein-pool.mjs --rpc <public Robinhood Chain RPC> [--proof evidence/einstein/proof.json]
 *
 * It reads every address, transaction and expected value from proof.json and checks it on chain. One line per claim:
 *   P5 PASS  ...        the on-chain checks held
 *   P1 PARTIAL ...      true, but short of the bar the brief sets (for example a Sourcify match that is not an exact match)
 *   P3 PENDING ...      not yet on chain: no pool exists, so there is nothing to check
 *   P2 FAIL ...         a check failed. Exit code is non-zero if anything FAILs.
 * PENDING is never a PASS. A claim with no public evidence stays PENDING.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ZERO = `0x${'0'.repeat(64)}`;

export async function rpcFactory(url) {
  let id = 0;
  return async (method, params) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    if (!res.ok) throw new Error(`RPC ${method} returned HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) { const e = new Error(`RPC ${method}: ${body.error.message}`); e.data = typeof body.error.data === 'string' ? body.error.data : ''; throw e; }
    return body.result;
  };
}

const lower = (s) => String(s).toLowerCase();
const word = (hex, n) => `0x${hex.slice(2 + n * 64, 2 + (n + 1) * 64)}`;

async function runCheck(check, rpc, proof) {
  switch (check.kind) {
    case 'code': {
      const code = await rpc('eth_getCode', [check.address, 'latest']);
      return { ok: code !== '0x' && code.length > 2, note: `${check.label ?? check.address} has code` };
    }
    case 'storageZero': {
      for (const slot of check.slots) {
        const v = await rpc('eth_getStorageAt', [check.address, slot, 'latest']);
        if (BigInt(v) !== 0n) return { ok: false, note: `${check.label ?? check.address} slot ${slot.slice(0, 10)} is not zero` };
      }
      return { ok: true, note: `${check.label ?? check.address} proxy slots are zero` };
    }
    case 'txSuccess': {
      const r = await rpc('eth_getTransactionReceipt', [check.tx]);
      if (!r) return { ok: false, note: `tx ${check.tx.slice(0, 10)} not found` };
      if (r.status !== '0x1') return { ok: false, note: `tx ${check.tx.slice(0, 10)} did not succeed` };
      if (check.to && lower(r.to) !== lower(check.to)) return { ok: false, note: `tx ${check.tx.slice(0, 10)} went to ${r.to}, expected ${check.to}` };
      return { ok: true, note: `${check.label ?? 'tx'} succeeded in block ${parseInt(r.blockNumber, 16)}`, gasUsed: parseInt(r.gasUsed, 16) };
    }
    case 'txReverted': {
      const r = await rpc('eth_getTransactionReceipt', [check.tx]);
      if (!r) return { ok: false, note: `tx ${check.tx.slice(0, 10)} not found` };
      return { ok: r.status === '0x0', note: `${check.label ?? 'tx'} reverted on chain` };
    }
    case 'callWord': {
      const out = await rpc('eth_call', [{ to: check.to, data: check.data }, 'latest']);
      const got = BigInt(word(out, check.word));
      return { ok: got === BigInt(check.equals), note: `${check.label}: ${got}` };
    }
    case 'callWordMin': {
      const out = await rpc('eth_call', [{ to: check.to, data: check.data }, 'latest']);
      const got = BigInt(word(out, check.word));
      return { ok: got >= BigInt(check.min), note: `${check.label}: ${got}` };
    }
    case 'callAddress': {
      const out = await rpc('eth_call', [{ to: check.to, data: check.data }, 'latest']);
      const got = `0x${word(out, check.word).slice(26)}`;
      return { ok: lower(got) === lower(check.equals), note: `${check.label}: ${got}` };
    }
    case 'swapFee': {
      // The PoolManager Swap event carries the fee the hook set for this swap, in pips.
      const r = await rpc('eth_getTransactionReceipt', [check.tx]);
      if (!r || r.status !== '0x1') return { ok: false, note: `swap tx ${check.tx.slice(0, 10)} is missing or failed` };
      const SWAP = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
      const ev = r.logs.find((l) => lower(l.address) === lower(check.poolManager) && l.topics[0] === SWAP);
      if (!ev) return { ok: false, note: 'no PoolManager Swap event in the receipt' };
      const fee = parseInt(word(ev.data, 5), 16);
      return { ok: fee === check.expectedFee, note: `${check.label}: fee ${fee} pips`, gasUsed: parseInt(r.gasUsed, 16) };
    }
    case 'revertReason': {
      // Replays the reverted transaction one block earlier and looks for the named error selector in the revert data.
      const r = await rpc('eth_getTransactionReceipt', [check.tx]);
      if (!r || r.status !== '0x0') return { ok: false, note: `tx ${check.tx.slice(0, 10)} did not revert on chain` };
      const t = await rpc('eth_getTransactionByHash', [check.tx]);
      const before = `0x${(parseInt(r.blockNumber, 16) - 1).toString(16)}`;
      try {
        await rpc('eth_call', [{ from: t.from, to: t.to, data: t.input }, before]);
        return { ok: false, note: `replay of ${check.tx.slice(0, 10)} did not revert` };
      } catch (e) {
        const data = lower(e.data ?? '');
        if (data.includes(check.selector.slice(2))) return { ok: true, note: `${check.label}: reverted, ${check.error} selector found in the revert data` };
        // A public RPC prunes old state: without the state of the block before the transaction there is no revert data to read, which says nothing
        // about the transaction. It reverted (the receipt says so); the error name needs an archive node.
        if (!data && /historical state|not available|missing trie|header not found|pruned/i.test(String(e.message))) {
          return { ok: false, partial: true, note: `${check.label} did revert on chain (receipt status 0); this RPC no longer has the state of the block before it, so ${check.error} (${check.selector}) needs an archive node to read` };
        }
        return { ok: false, note: `${check.label}: reverted, ${check.error} selector not found in the revert data` };
      }
    }
    case 'hookBits': {
      const bits = Number(BigInt(check.hook) & 0x3fffn);
      const off = [9, 8, 0].every((b) => ((bits >> b) & 1) === 0);
      return { ok: bits === 0x2cc0 && off, note: `hook low 14 bits 0x${bits.toString(16)}, remove-liquidity bits off: ${off}` };
    }
    case 'sourcify': {
      const res = await fetch(`https://sourcify.dev/server/v2/contract/${proof.chain.id}/${check.address}?fields=all`);
      if (!res.ok) return { ok: false, note: `${check.label} is not on Sourcify (HTTP ${res.status})` };
      const body = await res.json();
      const m = body.match ?? body.creationMatch ?? 'none';
      return { ok: m === 'exact_match' || m === 'match', exact: m === 'exact_match', note: `${check.label}: ${m}` };
    }
    default:
      throw new Error(`unknown check kind ${check.kind}`);
  }
}

export async function runProof(proof, rpc) {
  const results = [];
  for (const claim of proof.claims) {
    if (!claim.checks?.length) { results.push({ id: claim.id, verdict: 'PENDING', note: claim.pending ?? 'no on-chain evidence yet', gas: [] }); continue; }
    let failed = null; let partial = null; let partialNote = null; const gas = []; let sourcifyTotal = 0; let sourcifyExact = 0;
    for (const check of claim.checks) {
      try {
        const r = await runCheck(check, rpc, proof);
        if (r.gasUsed) gas.push({ label: check.label, gasUsed: r.gasUsed });
        if (!r.ok && r.partial) { partialNote = r.note; continue; }
        if (!r.ok) { failed = r.note; break; }
        if (check.kind === 'sourcify') { sourcifyTotal += 1; if (r.exact) sourcifyExact += 1; }
      } catch (e) { failed = `${check.kind}: ${e.message}`; break; }
    }
    if (sourcifyTotal && sourcifyExact < sourcifyTotal) partial = `${sourcifyExact} of ${sourcifyTotal} contracts are an exact match on Sourcify, and the other ${sourcifyTotal - sourcifyExact} are a match`;
    if (failed) results.push({ id: claim.id, verdict: 'FAIL', note: failed, gas });
    else if (partialNote) results.push({ id: claim.id, verdict: 'PARTIAL', note: partialNote, gas });
    else if (partial || claim.partial) results.push({ id: claim.id, verdict: 'PARTIAL', note: partial ?? claim.partial, gas });
    else results.push({ id: claim.id, verdict: 'PASS', note: claim.passNote ?? 'all checks held', gas });
  }
  return results;
}

export async function runNegatives(proof, rpc) {
  const out = [];
  for (const n of proof.negatives) {
    if (!n.check) { out.push({ id: n.id, verdict: 'PENDING', note: n.note }); continue; }
    try { const r = await runCheck(n.check, rpc, proof); out.push({ id: n.id, verdict: r.ok ? 'PASS' : r.partial ? 'PARTIAL' : 'FAIL', note: r.note }); }
    catch (e) { out.push({ id: n.id, verdict: 'FAIL', note: e.message }); }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const proof = JSON.parse(readFileSync(arg('proof', 'evidence/einstein/proof.json'), 'utf8'));
  const url = arg('rpc', process.env.RPC_URL);
  if (!url) { console.error('usage: verify-einstein-pool.mjs --rpc <public RPC url>'); process.exit(2); }
  const rpc = await rpcFactory(url);
  const chainId = parseInt(await rpc('eth_chainId', []), 16);
  if (chainId !== proof.chain.id) { console.error(`RPC is chain ${chainId}, expected ${proof.chain.id}`); process.exit(2); }
  const results = await runProof(proof, rpc);
  const negatives = await runNegatives(proof, rpc);
  for (const r of [...results, ...negatives]) console.log(`${r.id.padEnd(4)} ${r.verdict.padEnd(7)} ${r.note}`);
  results.push(...negatives);
  const count = (v) => results.filter((r) => r.verdict === v).length;
  console.log(`\n${count('PASS')} PASS, ${count('PARTIAL')} PARTIAL, ${count('PENDING')} PENDING, ${count('FAIL')} FAIL`);
  process.exit(count('FAIL') ? 1 : 0);
}
