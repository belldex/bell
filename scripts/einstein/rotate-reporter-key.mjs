#!/usr/bin/env node
/**
 * One-off recovery for the REPORTER post-quantum key on mainnet when the local signer is exactly one leaf ahead of the chain.
 *
 * What happened: a delegate renewal signed with leaf 12 and then could not send its transaction (the sender wallet was empty). The signer state
 * moved to leaf 13, the registry still expects 12, and it has no way to skip a leaf. The only exit is HybridAuth.rotateRoleKey, which the
 * REPORTER role must authorize itself, so this signs the rotation digest at that one unspent leaf (leaf 12) and retires the key straight away.
 * That is the single deliberate reuse of a leaf: the earlier signature on it never reached the chain, and leaf 12 is consumed by this call.
 *
 * Safeguards: it refuses to run unless the local signer is exactly one ahead of the registry, the registry's ECDSA signer matches the key in the
 * environment, and the call simulates cleanly on mainnet first. Without --broadcast it only simulates. The new key is generated here, sealed with
 * the same encryption key, and only becomes `reporter` after the chain confirms the rotation; the old state is kept as `reporter-retired-v<version>`.
 *
 *   node scripts/einstein/rotate-reporter-key.mjs [--broadcast]
 */
import { readFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseAbi, parseAbiParameters, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const broadcast = process.argv.includes('--broadcast');
const env = {};
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); } } catch { /* CI passes the environment */ }
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
const acct = (n) => { if (!env[n]) throw new Error(`${n} is not set`); return privateKeyToAccount(env[n].startsWith('0x') ? env[n] : `0x${env[n]}`); };
const KEY_DIR = 'contracts/pq/keys/robinhood-4663';
const manifest = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet.json', 'utf8'));
const hybridAuth = manifest.contracts.hybridAuth;
const rpc = env.RH_MAINNET_RPC_PRIMARY;
const pc = createPublicClient({ transport: http(rpc) });
const sender = acct(env.ANT_SENDER_PRIVATE_KEY ? 'ANT_SENDER_PRIVATE_KEY' : 'RH_MAINNET_DEPLOYER_PRIVATE_KEY');
const wc = createWalletClient({ account: sender, transport: http(rpc) });
const reporterEcdsa = acct('YAHOO_REPORTER_PRIVATE_KEY');
const REPORTER = keccak256(stringToHex('REPORTER'));
const ROTATE_ACTION = keccak256(stringToHex('ROTATE_ROLE_KEY'));
const AUTH = parseAbi([
  'function nonce(bytes32 role) view returns (uint256)', 'function registry() view returns (address)',
  'function actionDigest(bytes32 role,address target,bytes32 action,bytes32 payloadHash,uint256 actionNonce,uint32 keyVersion,uint256 deadline) view returns (bytes32)',
  'function rotateRoleKey(bytes32 role,address nextSigner,bytes32 nextCommitment,uint32 nextMaxStatefulSignatures,uint256 deadline,bytes ecdsaSignature,bytes pqSignature)',
]);
const KEYS = parseAbi(['function roleKey(bytes32 role) view returns ((address ecdsaSigner,bytes32 publicKeyCommitment,uint32 maxStatefulSignatures,uint32 nextStatefulLeaf,uint32 keyVersion,bool installed))']);

const signer = (args, extraEnv = {}) => {
  const r = spawnSync(process.execPath, ['contracts/pq/signer/signer.mjs', ...args], { encoding: 'utf8', env: { ...process.env, BELL_PQ_KEY_PROFILE: 'robinhood-4663', ...extraEnv } });
  if (r.status !== 0) throw new Error(`signer ${args[0]} failed: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
};
const roleKey = async () => pc.readContract({ address: await pc.readContract({ address: hybridAuth, abi: AUTH, functionName: 'registry' }), abi: KEYS, functionName: 'roleKey', args: [REPORTER] });

const before = await roleKey();
const local = signer(['status', 'reporter']);
console.log(`registry: key version ${before.keyVersion}, next leaf ${before.nextStatefulLeaf}, commitment ${before.publicKeyCommitment.slice(0, 14)}...`);
console.log(`local signer: next leaf ${local.nextLeafIndex}, commitment ${String(local.publicKeyCommitment).slice(0, 14)}...`);
if (local.publicKeyCommitment.toLowerCase() !== before.publicKeyCommitment.toLowerCase()) throw new Error('the local signer is not the key the registry holds: nothing done');
if (Number(local.nextLeafIndex) !== Number(before.nextStatefulLeaf) + 1) throw new Error(`the local signer is not exactly one leaf ahead of the registry (local ${local.nextLeafIndex}, chain ${before.nextStatefulLeaf}): this recovery does not apply, nothing done`);
if (reporterEcdsa.address.toLowerCase() !== before.ecdsaSigner.toLowerCase()) throw new Error('the REPORTER ECDSA key in the environment is not the registry signer: nothing done');

if (existsSync(`${KEY_DIR}/reporter-next.enc`)) throw new Error('reporter-next.enc already exists: a previous attempt left state, look at it before running again');
const fresh = signer(['init', 'reporter-next', String(before.maxStatefulSignatures)]);
console.log(`new key generated: budget ${fresh.maxSignatures}, commitment ${fresh.publicKeyCommitment}`);

const nonce = await pc.readContract({ address: hybridAuth, abi: AUTH, functionName: 'nonce', args: [REPORTER] });
const now = Number((await pc.getBlock()).timestamp);
const deadline = BigInt(now + 900);
const payloadHash = keccak256(encodeAbiParameters(parseAbiParameters('address nextSigner,bytes32 nextCommitment,uint32 nextMax'), [before.ecdsaSigner, fresh.publicKeyCommitment, fresh.maxSignatures]));
const digest = await pc.readContract({ address: hybridAuth, abi: AUTH, functionName: 'actionDigest', args: [REPORTER, hybridAuth, ROTATE_ACTION, payloadHash, nonce, before.keyVersion, deadline] });
const ecdsa = await reporterEcdsa.sign({ hash: digest });
const pq = signer(['preview-reuse', 'reporter', digest, String(before.nextStatefulLeaf)], { BELL_PQ_ALLOW_REUSE_PROOF: '1' });
if (Number(pq.leafIndex) !== Number(before.nextStatefulLeaf)) throw new Error('the signature is not at the leaf the registry expects');
const args = [REPORTER, before.ecdsaSigner, fresh.publicKeyCommitment, fresh.maxSignatures, deadline, ecdsa, pq.signature];
await pc.simulateContract({ address: hybridAuth, abi: AUTH, functionName: 'rotateRoleKey', args, account: sender });
console.log('simulation on mainnet passed');
if (!broadcast) { console.log('dry run: nothing sent. The generated key is not saved.'); process.exit(0); }

const gasPrice = await pc.getGasPrice();
const have = await pc.getBalance({ address: sender.address });
if (have < 4_000_000n * gasPrice * 2n) throw new Error(`the sender holds ${have} wei, not enough to be sure the transaction goes out: nothing sent`);
const hash = await wc.writeContract({ address: hybridAuth, abi: AUTH, functionName: 'rotateRoleKey', args, gas: 4_000_000n });
console.log(`rotation sent: ${hash}`);
const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 240_000 });
if (receipt.status !== 'success') throw new Error(`the rotation transaction ${hash} did not succeed; the new key stays as reporter-next and the old one as reporter`);
const after = await roleKey();
if (after.keyVersion !== before.keyVersion + 1 || after.publicKeyCommitment.toLowerCase() !== fresh.publicKeyCommitment.toLowerCase() || Number(after.nextStatefulLeaf) !== 1) throw new Error('the chain does not show the new key after the rotation: files left as they are for inspection');

// Confirmed on chain: retire the old state and make the new key the `reporter`.
const v = Number(before.keyVersion);
renameSync(`${KEY_DIR}/reporter.enc`, `${KEY_DIR}/reporter-retired-v${v}.enc`);
renameSync(`${KEY_DIR}/reporter.public.json`, `${KEY_DIR}/reporter-retired-v${v}.public.json`);
renameSync(`${KEY_DIR}/reporter-next.enc`, `${KEY_DIR}/reporter.enc`);
const meta = JSON.parse(readFileSync(`${KEY_DIR}/reporter-next.public.json`, 'utf8'));
writeFileSync(`${KEY_DIR}/reporter.public.json`, `${JSON.stringify({ ...meta, role: 'reporter' }, null, 2)}\n`);
renameSync(`${KEY_DIR}/reporter-next.public.json`, `${KEY_DIR}/reporter-next.public.json.done`);
console.log(`rotated: key version ${after.keyVersion}, next leaf ${after.nextStatefulLeaf}, tx ${hash}`);
