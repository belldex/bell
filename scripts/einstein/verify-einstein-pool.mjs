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
    if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
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
    case 'hookBits': {
      const bits = Number(BigInt(check.hook) & 0x3fffn);
      const off = [9, 8, 0].every((b) => ((bits >> b) & 1) === 0);
      return { ok: bits === 0x2cc0 && off, note: `hook low 14 bits 0x${bits.toString(16)}, remove-liquidity bits off: ${off}` };
    }
    case 'sourcify': {
      const res = await fetch(`https://sourcify.dev/server/v2/contract/${proof.chain.id}/${check.address}`);
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
    let failed = null; let partial = null; const gas = [];
    for (const check of claim.checks) {
      try {
        const r = await runCheck(check, rpc, proof);
        if (r.gasUsed) gas.push({ label: check.label, gasUsed: r.gasUsed });
        if (!r.ok) { failed = r.note; break; }
        if (check.kind === 'sourcify' && !r.exact && !partial) partial = 'Sourcify shows match, not exact_match, on every contract checked';
      } catch (e) { failed = `${check.kind}: ${e.message}`; break; }
    }
    if (failed) results.push({ id: claim.id, verdict: 'FAIL', note: failed, gas });
    else if (partial || claim.partial) results.push({ id: claim.id, verdict: 'PARTIAL', note: partial ?? claim.partial, gas });
    else results.push({ id: claim.id, verdict: 'PASS', note: claim.passNote ?? 'all checks held', gas });
  }
  return results;
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
  for (const r of results) console.log(`${r.id.padEnd(4)} ${r.verdict.padEnd(7)} ${r.note}`);
  const count = (v) => results.filter((r) => r.verdict === v).length;
  console.log(`\n${count('PASS')} PASS, ${count('PARTIAL')} PARTIAL, ${count('PENDING')} PENDING, ${count('FAIL')} FAIL`);
  process.exit(count('FAIL') ? 1 : 0);
}
