#!/usr/bin/env node
/**
 * Records a trading halt, renews it, or records the resume, on the HaltRegistry of the Einstein Hooks v3 stack. Every call is hybrid-signed:
 * ECDSA by the REPORTER role's signer and SHRINCS by the local REPORTER signer state, one leaf per call.
 *
 *   node scripts/einstein/halt-reporter.mjs status
 *   node scripts/einstein/halt-reporter.mjs halt   --asset <id|label> [--started-at <unix>] [--reason LULD] --broadcast
 *   node scripts/einstein/halt-reporter.mjs renew  --asset <id|label> --broadcast
 *   node scripts/einstein/halt-reporter.mjs resume --asset <id|label> [--resumed-at <unix>] --broadcast
 *
 * Default is a simulation: the signature is built and the call is simulated, nothing is sent. Add --network mainnet for 4663 (also needs
 * --i-authorize-spend). --asset takes a bytes32 descriptor id or a label read from the ANT state file (--state).
 *
 * The reporter reads PUBLIC halt data, so the halt lands on chain some minutes after the exchange's own: pass --started-at with the
 * exchange's time and the registry records both, and `reportDelay` is what the page publishes for that halt.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseAbiParameters, parseAbi, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const command = process.argv[2] ?? 'status';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const broadcast = process.argv.includes('--broadcast');
const MAINNET = arg('network', 'testnet') === 'mainnet';
if (MAINNET && broadcast && !process.argv.includes('--i-authorize-spend')) throw new Error('a mainnet broadcast needs --broadcast --i-authorize-spend');
const env = {}; for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const acct = (n) => privateKeyToAccount(env[n].startsWith('0x') ? env[n] : `0x${env[n]}`);
const halt = JSON.parse(readFileSync(MAINNET ? 'evidence/deploy/halt-stack-4663.json' : 'evidence/deploy/halt-stack-testnet-46630.json', 'utf8'));
if (halt.status !== 'BROADCAST') throw new Error('the halt stack manifest is not a broadcast deployment');
const REGISTRY = halt.contracts.haltRegistry; const AUTH = halt.reused.hybridAuth;
const rpc = MAINNET ? env.RH_MAINNET_RPC_PRIMARY : env.RH_TESTNET_RPC_PRIMARY;
const pc = createPublicClient({ transport: http(rpc) });
const sender = acct(MAINNET && env.RH_MAINNET_DEPLOYER_PRIVATE_KEY ? 'RH_MAINNET_DEPLOYER_PRIVATE_KEY' : 'DEPLOYER_PRIVATE_KEY'); // only pays gas
const wc = createWalletClient({ account: sender, transport: http(rpc) });
const REPORTER = keccak256(stringToHex('REPORTER'));
const ACTION = { halt: keccak256(stringToHex('BELL_HALT_V1')), renew: keccak256(stringToHex('BELL_HALT_RENEW_V1')), resume: keccak256(stringToHex('BELL_HALT_RESUME_V1')) };

const REG = parseAbi([
  'function halt(bytes32 assetId,uint64 haltId,uint64 startTs,bytes32 reason,uint256 deadline,bytes ecdsaSignature,bytes pqSignature)',
  'function renew(bytes32 assetId,uint64 haltId,uint256 deadline,bytes ecdsaSignature,bytes pqSignature)',
  'function resume(bytes32 assetId,uint64 haltId,uint64 resumeTs,uint256 deadline,bytes ecdsaSignature,bytes pqSignature)',
  'function phase(bytes32 assetId) view returns (uint8)',
  'function lastHaltId(bytes32 assetId) view returns (uint64)',
  'function haltedUntil(bytes32 assetId) view returns (uint64)',
  'function leavesUsed() view returns (uint32)',
  'function rotationDue() view returns (bool)',
  'function reportDelay(bytes32 assetId) view returns (uint64)',
  'function current(bytes32 assetId) view returns ((uint64 haltId,uint64 startTs,uint64 recordedAt,uint64 expiresAt,uint64 resumedAt,uint64 resumeTs,bytes32 reason,bool active))',
]);
const HYBRID = parseAbi(['function nonce(bytes32 role) view returns (uint256)', 'function registry() view returns (address)', 'function actionDigest(bytes32 role,address target,bytes32 action,bytes32 payloadHash,uint256 actionNonce,uint32 keyVersion,uint256 deadline) view returns (bytes32)']);
const KEYS = parseAbi(['function roleKey(bytes32 role) view returns ((address ecdsaSigner,bytes32 publicKeyCommitment,uint32 maxStatefulSignatures,uint32 nextStatefulLeaf,uint32 keyVersion,bool installed))']);
const PHASES = ['NORMAL', 'HALTED', 'RESUME_AUCTION'];

function assetId() {
  const a = arg('asset');
  if (!a) throw new Error('pass --asset <bytes32 id or label>');
  if (/^0x[0-9a-f]{64}$/i.test(a)) return a;
  const state = JSON.parse(readFileSync(arg('state', MAINNET ? 'evidence/deploy/mainnet-4663-ant.json' : 'evidence/deploy/testnet-46630-ant-delegated.json'), 'utf8'));
  if (!state.admittedDescriptorId) throw new Error('the state file has no admittedDescriptorId');
  return state.admittedDescriptorId;
}

const pq = (cmd, digest, leaf) => {
  const r = spawnSync(process.execPath, ['contracts/pq/signer/signer.mjs', cmd, 'reporter', digest], { encoding: 'utf8', env: { ...process.env, BELL_PQ_KEY_PROFILE: MAINNET ? 'robinhood-4663' : 'robinhood-46630' } });
  if (r.status !== 0) throw new Error(`pq ${cmd} failed: ${r.stderr.trim()}`);
  const out = JSON.parse(r.stdout);
  if (Number(out.leafIndex) !== Number(leaf)) throw new Error(`local reporter signer at leaf ${out.leafIndex}, chain expects ${leaf}`);
  return out.signature;
};

/** Builds the hybrid signature for one action and returns { deadline, ecdsa, pq, leaf }. `sign` false returns the preview (simulation only). */
export async function hybrid(action, payloadHash, sign) {
  const reporter = acct('YAHOO_REPORTER_PRIVATE_KEY');
  const registry = await pc.readContract({ address: AUTH, abi: HYBRID, functionName: 'registry' });
  const [nonce, key, block] = await Promise.all([pc.readContract({ address: AUTH, abi: HYBRID, functionName: 'nonce', args: [REPORTER] }), pc.readContract({ address: registry, abi: KEYS, functionName: 'roleKey', args: [REPORTER] }), pc.getBlock()]);
  const deadline = block.timestamp + 3600n;
  const digest = await pc.readContract({ address: AUTH, abi: HYBRID, functionName: 'actionDigest', args: [REPORTER, REGISTRY, action, payloadHash, nonce, key.keyVersion, deadline] });
  const ecdsa = await reporter.sign({ hash: digest });
  return { deadline, ecdsa, pq: pq(sign ? 'sign' : 'preview', digest, key.nextStatefulLeaf), leaf: key.nextStatefulLeaf };
}

const payload = (types, values) => keccak256(encodeAbiParameters(parseAbiParameters(types), values));

/** Sends one registry call. Returns { tx, leaf } when broadcast, { simulated: true } otherwise. */
export async function send(name, args, build) {
  const preview = await hybrid(ACTION[name], build.payloadHash, false);
  await pc.simulateContract({ address: REGISTRY, abi: REG, functionName: name, args: build.args(preview.deadline, preview.ecdsa, preview.pq), account: sender });
  if (!broadcast) return { simulated: true, leaf: preview.leaf };
  const signed = await hybrid(ACTION[name], build.payloadHash, true);
  const tx = await wc.writeContract({ address: REGISTRY, abi: REG, functionName: name, args: build.args(signed.deadline, signed.ecdsa, signed.pq), gas: 4_000_000n });
  const r = await pc.waitForTransactionReceipt({ hash: tx });
  if (r.status !== 'success') throw new Error(`${name} reverted: ${tx}`);
  return { tx, leaf: signed.leaf, block: Number(r.blockNumber) };
}

export async function doHalt(id, startTs, reasonText) {
  const haltId = (await pc.readContract({ address: REGISTRY, abi: REG, functionName: 'lastHaltId', args: [id] })) + 1n;
  const reason = keccak256(stringToHex(reasonText));
  const payloadHash = payload('address registry,bytes32 asset,uint64 haltId,uint64 startTs,bytes32 reason', [REGISTRY, id, haltId, startTs, reason]);
  const r = await send('halt', null, { payloadHash, args: (d, e, p) => [id, haltId, startTs, reason, d, e, p] });
  return { ...r, haltId };
}

export async function doResume(id, resumeTs) {
  const cur = await pc.readContract({ address: REGISTRY, abi: REG, functionName: 'current', args: [id] });
  const payloadHash = payload('address registry,bytes32 asset,uint64 haltId,uint64 resumeTs', [REGISTRY, id, cur.haltId, resumeTs]);
  const r = await send('resume', null, { payloadHash, args: (d, e, p) => [id, cur.haltId, resumeTs, d, e, p] });
  return { ...r, haltId: cur.haltId };
}

export async function doRenew(id) {
  const cur = await pc.readContract({ address: REGISTRY, abi: REG, functionName: 'current', args: [id] });
  const payloadHash = payload('address registry,bytes32 asset,uint64 haltId,uint64 expiresAt', [REGISTRY, id, cur.haltId, cur.expiresAt]);
  const r = await send('renew', null, { payloadHash, args: (d, e, p) => [id, cur.haltId, d, e, p] });
  return { ...r, haltId: cur.haltId };
}

export async function status(id) {
  const [phase, until, used, due] = await Promise.all([
    pc.readContract({ address: REGISTRY, abi: REG, functionName: 'phase', args: [id] }), pc.readContract({ address: REGISTRY, abi: REG, functionName: 'haltedUntil', args: [id] }),
    pc.readContract({ address: REGISTRY, abi: REG, functionName: 'leavesUsed' }), pc.readContract({ address: REGISTRY, abi: REG, functionName: 'rotationDue' }),
  ]);
  return { phase: PHASES[phase], haltedUntil: Number(until), leavesUsed: used, rotationDue: due };
}

if (import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  const now = Number((await pc.getBlock()).timestamp);
  if (command === 'status') {
    const id = assetId();
    console.log(JSON.stringify(await status(id)), 'registry', REGISTRY);
    const cur = await pc.readContract({ address: REGISTRY, abi: REG, functionName: 'current', args: [id] });
    if (cur.active) console.log(`halt ${cur.haltId}: exchange start ${cur.startTs}, recorded ${cur.recordedAt} (delay ${cur.recordedAt - cur.startTs} s), expires ${cur.expiresAt}, resumed ${cur.resumedAt}`);
  } else if (command === 'halt') {
    console.log(await doHalt(assetId(), BigInt(arg('started-at', String(now - 30))), arg('reason', 'LULD')));
  } else if (command === 'renew') {
    console.log(await doRenew(assetId()));
  } else if (command === 'resume') {
    console.log(await doResume(assetId(), BigInt(arg('resumed-at', String(now)))));
  } else throw new Error('usage: halt-reporter.mjs status|halt|renew|resume');
}
