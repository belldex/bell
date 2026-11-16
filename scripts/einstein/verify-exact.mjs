#!/usr/bin/env node
/**
 * Submits a deployed contract to Sourcify with its own compiler metadata and the exact source files that metadata names, which is
 * how an exact match is reached. Each file is taken from the working copy (as is, or with LF line endings) and, if its recorded
 * hash does not match, from the git revision that does. Nothing is submitted unless every source reproduces its recorded hash.
 *
 *   node scripts/einstein/verify-exact.mjs <address> <path to the build artifact json with rawMetadata>
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { keccak256, toBytes } from 'viem';

const [, , address, artifactPath] = process.argv;
const root = 'contracts';
const raw = JSON.parse(readFileSync(artifactPath, 'utf8')).rawMetadata;
const meta = JSON.parse(raw);
const remaps = [['@uniswap/v4-core/', 'lib/v4-core/'], ['@openzeppelin/contracts/', 'lib/openzeppelin-contracts/contracts/'], ['openzeppelin-contracts/', 'lib/openzeppelin-contracts/'], ['permit2/', 'lib/permit2/'], ['solmate/', 'lib/solmate/']];
const hash = (t) => keccak256(toBytes(t));

function fromHistory(path, want) {
  const commits = execFileSync('git', ['log', '--format=%H', '--', path], { encoding: 'utf8' }).trim().split('\n');
  for (const c of commits) {
    let text; try { text = execFileSync('git', ['show', `${c}:${path}`], { encoding: 'utf8', maxBuffer: 50_000_000 }); } catch { continue; }
    for (const v of [text, text.replace(/\r\n/g, '\n')]) if (hash(v) === want) return { content: v, from: c.slice(0, 8) };
  }
  return null;
}

const files = {};
const notes = [];
for (const [key, info] of Object.entries(meta.sources)) {
  const rel = [`${root}/${key}`, ...remaps.filter(([p]) => key.startsWith(p)).map(([p, d]) => `${root}/${d}${key.slice(p.length)}`)].find(existsSync);
  if (!rel) throw new Error(`source not found for ${key}`);
  const text = readFileSync(rel, 'utf8');
  const hit = [text, text.replace(/\r\n/g, '\n')].find((v) => hash(v) === info.keccak256);
  if (hit !== undefined) { files[key] = hit; continue; }
  const old = fromHistory(rel, info.keccak256);
  if (!old) throw new Error(`no revision of ${key} reproduces its recorded hash`);
  files[key] = old.content; notes.push(`${key} from ${old.from}`);
}
console.log(`${Object.keys(files).length} sources reproduce their recorded hashes${notes.length ? ` (${notes.join(', ')})` : ''}`);
// Sourcify v2: the metadata file and the sources it names, by chain and address.
const res = await fetch(`https://sourcify.dev/server/v2/verify/metadata/4663/${address}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sources: files, metadata: meta }) });
const body = await res.text();
console.log(res.status, body.slice(0, 300));
const jobId = (() => { try { return JSON.parse(body).verificationId; } catch { return null; } })();
for (let i = 0; jobId && i < 20; i += 1) {
  await new Promise((r) => setTimeout(r, 4000));
  const job = await (await fetch(`https://sourcify.dev/server/v2/verify/${jobId}`)).json();
  if (job.isJobCompleted) { console.log(JSON.stringify({ match: job.contract?.match, creationMatch: job.contract?.creationMatch, runtimeMatch: job.contract?.runtimeMatch, error: job.error?.message }).slice(0, 300)); break; }
}
