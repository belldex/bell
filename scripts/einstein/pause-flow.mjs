#!/usr/bin/env node
/**
 * Pause the first Einstein pool through SafetyControllerV2 with both signatures, and resume it the same way. These are the only
 * Einstein scripts that spend real signing leaves: a pause uses one GUARDIAN leaf, a resume uses one GOVERNANCE leaf.
 *
 *   node scripts/einstein/pause-flow.mjs pause              # simulate
 *   node scripts/einstein/pause-flow.mjs pause --broadcast
 *   node scripts/einstein/pause-flow.mjs resume --broadcast
 *
 * Safety: the transaction is simulated with a `preview` signature before the signer is asked to `sign`, which is the only call
 * that advances a leaf. After signing, the transaction is sent at once. The script then checks that the on-chain leaf counter moved by exactly one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, keccak256, toBytes, hashTypedData, parseAbi, encodeAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const command = process.argv[2];
const broadcast = process.argv.includes('--broadcast');
if (!['pause', 'resume'].includes(command)) throw new Error('usage: pause-flow.mjs pause|resume [--broadcast]');
const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const pq = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet.json', 'utf8'));
const c = pq.contracts;
const pool = JSON.parse(readFileSync('evidence/einstein/proof.json', 'utf8')).pool;
const rpcUrl = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY;
const sender = privateKeyToAccount(`0x${env.LP_TEST_PRIVATE_KEY.replace(/^0x/, '')}`);
const ecdsa = {
  GOVERNANCE: privateKeyToAccount(`0x${env.RH_MAINNET_DEPLOYER_PRIVATE_KEY.replace(/^0x/, '')}`),
  GUARDIAN: privateKeyToAccount(`0x${env.KEEPER_A_PRIVATE_KEY.replace(/^0x/, '')}`),
};
const pc = createPublicClient({ transport: http(rpcUrl) });
const wc = createWalletClient({ account: sender, transport: http(rpcUrl) });

const registryAbi = parseAbi(['function roleKey(bytes32) view returns (address ecdsaSigner, bytes32 publicKeyCommitment, uint32 maxStatefulSignatures, uint32 nextStatefulLeaf, uint32 keyVersion, bool installed)']);
const authAbi = parseAbi([
  'function nonce(bytes32) view returns (uint256)',
  'function actionDigest(bytes32 role, address target, bytes32 action, bytes32 payloadHash, uint256 nonce, uint32 keyVersion, uint256 deadline) view returns (bytes32)',
]);
const scAbi = parseAbi([
  'function pausePoolHybrid(address hook, uint256 deadline, bytes ecdsaSignature, bytes pqSignature)',
  'function queueResumeHybrid(bytes32 target, uint64 pauseNonce, uint256 deadline, bytes ecdsaSignature, bytes pqSignature) returns (bytes32)',
  'function executeResume(bytes32 operationId)',
  'function pauseState(bytes32 target) view returns (bool paused, uint64 nonce_)',
  'function operation(bytes32 operationId) view returns (uint8 kind, bytes32 payloadHash, uint64 eta, uint64 expiry, uint8 status)',
  'function targetId(uint8 targetKind, address target) pure returns (bytes32)',
  'function PAUSE_ACTION() view returns (bytes32)', 'function QUEUE_RESUME_ACTION() view returns (bytes32)',
]);
const domain = { name: 'BELL HybridAuth', version: '1', chainId: 4663, verifyingContract: c.hybridAuth };
const types = { HybridAction: [
  { name: 'role', type: 'bytes32' }, { name: 'target', type: 'address' }, { name: 'action', type: 'bytes32' },
  { name: 'payloadHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'keyVersion', type: 'uint32' }, { name: 'deadline', type: 'uint256' },
] };
const roleHash = (r) => keccak256(toBytes(r));
const log = (...a) => console.log(new Date().toISOString(), ...a);

function signer(mode, role, digest) {
  const r = spawnSync(process.execPath, ['contracts/pq/signer/signer.mjs', mode, role.toLowerCase(), digest], { encoding: 'utf8', env: { ...process.env, BELL_PQ_KEY_PROFILE: 'robinhood-4663' } });
  if (r.status !== 0) throw new Error(`PQ signer ${mode} failed: ${(r.stderr || '').trim()}`);
  return JSON.parse(r.stdout.trim());
}
async function roleState(role) {
  const id = roleHash(role);
  const [k, nonce] = await Promise.all([
    pc.readContract({ address: c.pqKeyRegistry, abi: registryAbi, functionName: 'roleKey', args: [id] }),
    pc.readContract({ address: c.hybridAuth, abi: authAbi, functionName: 'nonce', args: [id] }),
  ]);
  return { id, signer: k[0], nextLeaf: Number(k[3]), keyVersion: k[4], nonce };
}

/** Builds the authorization, proves by simulation that it would succeed, then signs for real and sends. */
async function run({ role, target, action, payloadHash, build, label }) {
  const before = await roleState(role);
  const local = JSON.parse(spawnSync(process.execPath, ['contracts/pq/signer/signer.mjs', 'status', role.toLowerCase()], { encoding: 'utf8', env: { ...process.env, BELL_PQ_KEY_PROFILE: 'robinhood-4663' } }).stdout);
  if (local.nextLeafIndex !== before.nextLeaf) throw new Error(`${role}: local signer is at leaf ${local.nextLeafIndex}, the chain expects ${before.nextLeaf}. Stopping.`);
  if (ecdsa[role].address.toLowerCase() !== before.signer.toLowerCase()) throw new Error(`${role}: the local ECDSA key is not the installed signer`);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const message = { role: before.id, target, action, payloadHash, nonce: before.nonce, keyVersion: before.keyVersion, deadline };
  const digest = hashTypedData({ domain, types, primaryType: 'HybridAction', message });
  const onchain = await pc.readContract({ address: c.hybridAuth, abi: authAbi, functionName: 'actionDigest', args: [before.id, target, action, payloadHash, before.nonce, before.keyVersion, deadline] });
  if (digest.toLowerCase() !== onchain.toLowerCase()) throw new Error('typed digest does not match the contract');
  const ecdsaSig = await ecdsa[role].signTypedData({ domain, types, primaryType: 'HybridAction', message });

  const preview = signer('preview', role, digest);
  const sim = await pc.simulateContract({ ...build(ecdsaSig, preview.signature, deadline), account: sender });
  log(`${label}: simulation with the preview signature succeeds (leaf ${preview.leafIndex})`);
  if (!broadcast) return { simulated: true, result: sim.result };

  const real = signer('sign', role, digest); // from here on the local leaf is spent
  log(`${role} leaf ${real.leafIndex} signed`);
  const request = build(ecdsaSig, real.signature, deadline);
  const { encodeFunctionData } = await import('viem');
  const hash = await wc.sendTransaction({ to: request.address, data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }), gas: 2_500_000n });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  let after = await roleState(role);
  // Some RPC nodes answer from a block behind the receipt, so give the counter a moment to show.
  for (let i = 0; i < 10 && after.nextLeaf === before.nextLeaf; i += 1) { await new Promise((r) => setTimeout(r, 3000)); after = await roleState(role); }
  log(`${label}: ${receipt.status} in block ${receipt.blockNumber}, ${role} next leaf ${before.nextLeaf} -> ${after.nextLeaf}`);
  if (receipt.status !== 'success' || after.nextLeaf !== before.nextLeaf + 1) throw new Error(`${label}: failed or the leaf counter did not move by one. Local leaf ${real.leafIndex} may now be ahead of the chain.`);
  return { hash, block: Number(receipt.blockNumber), leaf: real.leafIndex, result: sim.result };
}

const sc = c.safetyController;
const target = await pc.readContract({ address: sc, abi: scAbi, functionName: 'targetId', args: [1, pool.hook] });
const evidenceFile = 'evidence/einstein/pause.json';
let evidence = {}; try { evidence = JSON.parse(readFileSync(evidenceFile, 'utf8')); } catch { /* first run */ }

if (command === 'pause') {
  const [paused] = await pc.readContract({ address: sc, abi: scAbi, functionName: 'pauseState', args: [target] });
  if (paused) throw new Error('the pool is already paused');
  const action = await pc.readContract({ address: sc, abi: scAbi, functionName: 'PAUSE_ACTION' });
  const payloadHash = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'address' }], [1, pool.hook]));
  const r = await run({
    role: 'GUARDIAN', target: sc, action, payloadHash, label: 'pause',
    build: (e, p, deadline) => ({ address: sc, abi: scAbi, functionName: 'pausePoolHybrid', args: [pool.hook, deadline, e, p] }),
  });
  if (r.hash) { evidence.pause = { tx: r.hash, block: r.block, role: 'GUARDIAN', leaf: r.leaf, hook: pool.hook }; writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`); }
} else {
  const [paused, pauseNonce] = await pc.readContract({ address: sc, abi: scAbi, functionName: 'pauseState', args: [target] });
  if (!paused) throw new Error('the pool is not paused');
  const action = await pc.readContract({ address: sc, abi: scAbi, functionName: 'QUEUE_RESUME_ACTION' });
  const payloadHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint64' }], [target, pauseNonce]));
  const r = await run({
    role: 'GOVERNANCE', target: sc, action, payloadHash, label: 'queue resume',
    build: (e, p, deadline) => ({ address: sc, abi: scAbi, functionName: 'queueResumeHybrid', args: [target, pauseNonce, deadline, e, p] }),
  });
  if (r.hash) {
    const operationId = r.result;
    log('operation', operationId);
    const exec = await pc.simulateContract({ address: sc, abi: scAbi, functionName: 'executeResume', args: [operationId], account: sender });
    const hash = await wc.writeContract(exec.request);
    const receipt = await pc.waitForTransactionReceipt({ hash });
    const [nowPaused] = await pc.readContract({ address: sc, abi: scAbi, functionName: 'pauseState', args: [target] });
    log(`executeResume ${receipt.status}; paused now: ${nowPaused}`);
    evidence.resume = { queueTx: r.hash, queueBlock: r.block, role: 'GOVERNANCE', leaf: r.leaf, executeTx: hash, executeBlock: Number(receipt.blockNumber), pausedAfter: nowPaused };
    writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  }
}
