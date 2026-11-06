#!/usr/bin/env node
/**
 * BELL smart contract verification — terminal walkthrough for every BELL contract in use on Mainnet.
 *
 *   node scripts/auction-cli/bell-verify.mjs             check, submit to Sourcify, read back, show explorer links
 *   add --auto to run without "Press Enter" prompts, --fast to shorten delays, --dry to skip the Sourcify submit
 *   add --static to replay the last recorded result instantly (no network, no build) for screen recordings
 *
 * The contract list is scripts/auction-cli/targets.json (29 BELL contracts). Each one is compiled from the
 * commit that produced it with the production settings, compared byte for byte with the code on Robinhood
 * Chain (immutables masked), and only then submitted. Sources are public (MIT, github.com/belldex/bell).
 * Nothing here signs or sends a transaction. Results of a real run are saved to verified.json for --static.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { banner, bold, closeInput, dim, fail, flags, ink, ion, ionSoft, line, muted, ok, out, pad, prompt, short, sleep, step, typeText, warnRed } from './ui.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
const DRY = flags.has('--dry');
const STATIC = flags.has('--static');
const SOURCIFY = 'https://sourcify.dev/server';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const UA = { 'user-agent': 'bell-auction-cli/1.0 (https://github.com/belldex/bell)' };
const FULL_SOLC = '0.8.26+commit.8a97fa7a';

function loadEnv() {
  const env = { ...process.env };
  const path = join(root, '.env');
  if (!existsSync(path)) return env;
  for (const l of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function rpc(url, method, params) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30_000) });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function getJson(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { accept: 'application/json', ...UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  return { status: response.status, body };
}

const maskedCode = (hex, refs) => {
  const bytes = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  for (const list of Object.values(refs ?? {})) for (const { start, length } of list) bytes.fill(0, start, start + length);
  return bytes.toString('hex');
};

/** Build output for one target: build info from the commit that produced the deployed bytecode. */
const buildCache = new Map();
async function buildFor(target) {
  const dir = target.commit === 'current' ? join(root, 'contracts/.verify/build-info') : join(root, 'contracts/.verify/hist', target.commit, 'contracts/bi');
  if (!existsSync(dir)) throw new Error(`No build output for ${target.name} (${target.commit}); the contract sources have to be compiled first.`);
  if (!buildCache.has(dir)) {
    const builds = [];
    for (const f of await readdir(dir)) if (f.endsWith('.json')) builds.push(JSON.parse(await readFile(join(dir, f), 'utf8')));
    buildCache.set(dir, builds);
  }
  for (const build of buildCache.get(dir)) {
    const art = build.output?.contracts?.[target.file]?.[target.name];
    if (art) return { build, art };
  }
  throw new Error(`${target.name} is missing from the ${target.commit} build`);
}

async function main() {
  const env = loadEnv();
  const targets = JSON.parse(await readFile(join(here, 'targets.json'), 'utf8'));
  const savedPath = join(here, 'verified.json');
  const saved = existsSync(savedPath) ? JSON.parse(await readFile(savedPath, 'utf8')) : {};
  if (STATIC && !targets.every((t) => saved[t.address])) throw new Error('No recorded result yet. Run once without --static first.');
  const rpcUrl = env.RH_MAINNET_RPC_PRIMARY || 'https://rpc.mainnet.chain.robinhood.com';
  const total = targets.length;

  out();
  for (const l of banner('BELL')) { out(l); await sleep(70); }
  out();
  out(`${ion('●')} ${bold(ink('BELL PROTOCOL'))}  ${bold(ink('Smart contract verification'))}`);
  out(dim('Fees follow the session. Limits hold the line.'));
  out(line('─'.repeat(58)));
  out();
  out(`${ink(pad('Network', 10))}${ink('Robinhood Chain')} ${dim('· chain 4663')}`);
  out(`${ink(pad('Explorer', 10))}${ink(EXPLORER)}`);
  out(`${ink(pad('Contracts', 10))}${ink(`${total} BELL contracts in use on Mainnet`)}`);
  out(`${ink(pad('Method', 10))}${ink('source code verified by Sourcify against the bytecode')}`);
  out(`${pad('', 10)}${ink('deployed on-chain, then published to the explorer')}`);
  out();
  out(bold(ink('What happens')));
  ['Check that the chain and Sourcify are online', 'Prove each contract compiles to its on-chain bytecode', 'Submit the source code of every contract to Sourcify', 'Read every contract back as proof and open it on the explorer']
    .forEach((l, i) => out(`${ion(i + 1)}  ${ink(l)}`));
  out();
  process.stdout.write(`${ion('BELL')} ${line('|')} ${muted('live on Robinhood Chain')}${line('$')} `);
  await typeText('bell verify --all');
  await sleep(400);
  out();
  await prompt('Press Enter to start');

  // ── 1 checks ─────────────────────────────────────────────────────────────
  step(1, 4, 'Checks', 'Is the chain answering, and is Sourcify ready to receive source code?');
  const packages = [];
  if (STATIC) {
    await sleep(500); ok('Chain online (4663)');
    await sleep(500); ok('Sourcify online, chain 4663 supported');
    for (const t of targets) packages.push({ ...t, compilerVersion: FULL_SOLC });
  } else {
    const block = Number(await rpc(rpcUrl, 'eth_blockNumber', []));
    const chainId = Number(await rpc(rpcUrl, 'eth_chainId', []));
    if (chainId !== 4663) throw new Error(`wrong chain ${chainId}`);
    ok(`Chain online (${chainId}) · block ${block.toLocaleString('en-US')}`);
    const chains = await getJson(`${SOURCIFY}/chains`);
    if (!Array.isArray(chains.body) || !chains.body.some((x) => Number(x.chainId) === 4663 && x.supported)) throw new Error('Sourcify does not report chain 4663 as supported');
    ok('Sourcify online, chain 4663 supported');
    for (const t of targets) {
      const { build, art } = await buildFor(t);
      const onchain = await rpc(rpcUrl, 'eth_getCode', [t.address, 'latest']);
      const local = '0x' + art.evm.deployedBytecode.object;
      const refs = art.evm.deployedBytecode.immutableReferences;
      if (onchain.length !== local.length || maskedCode(onchain, refs) !== maskedCode(local, refs)) throw new Error(`${t.name} at ${t.address}: recompiled bytecode does not match the chain`);
      const metadata = typeof art.metadata === 'string' ? JSON.parse(art.metadata) : art.metadata;
      // Foundry records only "0.8.26"; Sourcify needs the full "0.8.26+commit.<hash>" to fetch the compiler.
      packages.push({ ...t, build, compilerVersion: metadata?.compiler?.version ?? FULL_SOLC });
    }
  }
  ok(`${total} source packages ready, each proven to compile to its on-chain bytecode`);

  // ── 2 verify ─────────────────────────────────────────────────────────────
  await prompt(`Press Enter to verify ${total} contracts`);
  step(2, 4, 'Verify', "Each contract's source code goes to Sourcify, which compiles it and compares it with the chain.");
  let group = '';
  for (const [i, p] of packages.entries()) {
    if (p.group !== group) { group = p.group; out(`\n${ionSoft(group)}`); }
    let status = DRY ? 'proven' : 'verified';
    if (STATIC) await sleep(420);
    else if (!DRY) {
      const submit = await getJson(`${SOURCIFY}/v2/verify/4663/${p.address}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stdJsonInput: p.build.input, compilerVersion: p.compilerVersion, contractIdentifier: `${p.file}:${p.name}` }),
      });
      if (submit.status === 202 || submit.status === 200) {
        let done = null;
        for (let n = 0; n < 60 && !done; n++) {
          await new Promise((r) => setTimeout(r, 2000));
          const poll = await getJson(`${SOURCIFY}/v2/verify/${submit.body.verificationId}`);
          if (poll.body.isJobCompleted) done = poll.body;
        }
        if (!done) throw new Error(`${p.name}: verification did not finish in time`);
        if (done.error && !/already verified/i.test(done.error.message ?? '')) throw new Error(`${p.name} ${p.label}: ${done.error.message ?? done.error.customCode}`);
      } else if (submit.status !== 409) throw new Error(`${p.name}: Sourcify answered ${submit.status} ${JSON.stringify(submit.body).slice(0, 160)}`);
    } else await sleep(150);
    out(`${ionSoft('✓')} ${dim(pad(`${i + 1}/${total}`, 6))}${ink(pad(p.name, 32))}${dim(pad(p.label, 24))}${muted(pad(short(p.address), 14))}${ion(bold(status))}`);
  }

  // ── 3 read back ──────────────────────────────────────────────────────────
  await prompt('Press Enter to read every contract back');
  step(3, 4, 'Read back', 'Each contract is read back from Sourcify as proof that the published source is the deployed code.');
  let matched = 0;
  group = '';
  const record = { ...saved };
  for (const [i, p] of packages.entries()) {
    if (p.group !== group) { group = p.group; out(`\n${ionSoft(group)}`); }
    let result;
    if (STATIC) { await sleep(300); result = saved[p.address]; }
    else {
      const read = await getJson(`${SOURCIFY}/v2/contract/4663/${p.address}`);
      result = { match: read.body?.runtimeMatch ?? read.body?.match ?? null, verifiedAt: read.body?.verifiedAt?.slice(0, 10) ?? null };
      if (result.match) record[p.address] = result;
    }
    const good = result?.match === 'exact_match' || result?.match === 'match';
    if (good) matched++;
    out(`${good ? ionSoft('✓') : (DRY ? dim('·') : warnRed('✗'))} ${dim(pad(`${i + 1}/${total}`, 6))}${ink(pad(p.name, 32))}${good ? ion(pad(result.match.replace('_', ' '), 8)) : dim(pad('pending', 8))}${dim(`solc ${p.compilerVersion.split('+')[0]}${result?.verifiedAt ? ` · ${result.verifiedAt}` : ''}`)}`);
  }
  if (!STATIC && !DRY) await writeFile(savedPath, `${JSON.stringify(record, null, 1)}\n`);
  if (!DRY && matched !== total) throw new Error(`only ${matched}/${total} contracts read back as verified`);

  // ── 4 explorer ───────────────────────────────────────────────────────────
  await prompt('Press Enter to open the contracts');
  step(4, 4, 'Explorer', 'Open any contract on the explorer.');
  group = '';
  for (const p of packages) {
    if (p.group !== group) { group = p.group; out(`\n${ionSoft(group)}`); }
    out(`  ${ink(pad(`${p.name} ${dim(p.label.startsWith('ref ') || p.group.includes('session') ? p.label : '')}`, 54))}${muted(`${EXPLORER}/address/${p.address}?tab=contract`)}`);
  }
  out();
  ok(DRY ? `All ${total} contracts proven against the chain (submit skipped)` : `${matched}/${total} contracts verified on Robinhood Chain`);
  out(`\n${ion('BELL')} ${line('|')} ${dim('Fees follow the session. Limits hold the line.')}\n`);
}

try { await main(); } catch (error) {
  fail(String(error?.message ?? error));
  process.exitCode = 1;
} finally { closeInput(); }
