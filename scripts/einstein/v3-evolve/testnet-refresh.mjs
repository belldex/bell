#!/usr/bin/env node
/**
 * Refreshes the v3 Evolve testnet run: rebuilds run-3.json and proof.json from the chain, replays E1 to E8, and commits and pushes only
 * the proof files and the bot log. Meant to run on a schedule while the run is live (the page reads proof.json).
 *
 *   node scripts/einstein/v3-evolve/testnet-refresh.mjs [--final] [--no-push]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
process.chdir(root);
const final = process.argv.includes('--final');
const env = {}; for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts }); if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').slice(0, 400)}`); return r; };
const node = process.execPath;
run(node, ['scripts/einstein/v3-evolve/testnet-make-run.mjs', '--status', final ? 'final' : 'live']);
run(node, ['scripts/einstein/build-v3-proof.mjs', '--rpc', env.RH_TESTNET_ARCHIVE_RPC || env.RH_TESTNET_RPC_PRIMARY, '--run']);
const files = ['evidence/einstein/v3-evolve/run-3.json', 'evidence/einstein/v3-evolve/proof.json', 'apps/web/components/einstein/v3-evolve-proof.json', 'evidence/einstein/v3-evolve/testnet-bot-log.jsonl'];
run('git', ['add', '--', ...files]);
const diff = run('git', ['diff', '--cached', '--quiet', '--', ...files], { allowFail: true });
if (diff.status === 0) { console.log('nothing changed'); process.exit(0); }
run('git', ['commit', '-q', '-m', `chore(einstein): refresh the v3 Evolve testnet run (${new Date().toISOString().slice(0, 16)}Z)`, '--', ...files]);
if (!process.argv.includes('--no-push')) run('git', ['push', '-q', 'origin', 'main']);
console.log('refreshed and pushed');
