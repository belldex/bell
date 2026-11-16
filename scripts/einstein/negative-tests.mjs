#!/usr/bin/env node
/**
 * Negative tests N1 to N4 on Robinhood Chain mainnet: attempts that must be refused by HybridAuth, each left on chain as a
 * reverted transaction. Nothing here can succeed, and it never consumes a signing leaf:
 *   - the post-quantum signatures come from `signer.mjs preview` and `preview-reuse`, which read the sealed key but do not advance it;
 *   - every attempt is simulated first and is only sent if the simulation reverts with the error the test expects;
 *   - a reverted transaction rolls back, so the on-chain leaf counter does not move. The script checks that it did not.
 *
 *   node scripts/einstein/negative-tests.mjs            # simulate only
 *   node scripts/einstein/negative-tests.mjs --broadcast
 *
 *   N1  calendar root signed with ECDSA only         N2  valid ECDSA, post-quantum signature from a different role's key
 *   N3  a post-quantum leaf that was already spent    N4  pause through SafetyControllerV2 with ECDSA only
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, keccak256, toBytes, hashTypedData, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildCalendarRootGovernanceCall } from '../deploy/mainnet-calendar-hybrid-lib.mjs';

const broadcast = process.argv.includes('--broadcast');
const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const pq = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet.json', 'utf8'));
const c = pq.contracts;
const dir = 'evidence/einstein';
const poolFile = readdirSyncSafe();
function readdirSyncSafe() { return JSON.parse(readFileSync('evidence/einstein/proof.json', 'utf8')).pool; }
const pool = poolFile;
const nvdaState = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet-calendar-state-NVDA.json', 'utf8'));

const rpcUrl = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY;
const sender = privateKeyToAccount(`0x${env.LP_TEST_PRIVATE_KEY.replace(/^0x/, '')}`);
const ecdsaKeys = {
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
  'function queueGovernanceCall(address target, bytes callData, uint256 deadline, bytes ecdsaSignature, bytes pqSignature) returns (bytes32)',
  'function pausePoolHybrid(address hook, uint256 deadline, bytes ecdsaSignature, bytes pqSignature)',
  'function QUEUE_CALL_ACTION() view returns (bytes32)', 'function PAUSE_ACTION() view returns (bytes32)',
]);
const domain = { name: 'BELL HybridAuth', version: '1', chainId: 4663, verifyingContract: c.hybridAuth };
const types = { HybridAction: [
  { name: 'role', type: 'bytes32' }, { name: 'target', type: 'address' }, { name: 'action', type: 'bytes32' },
  { name: 'payloadHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'keyVersion', type: 'uint32' }, { name: 'deadline', type: 'uint256' },
] };
const roleHash = (r) => keccak256(toBytes(r));
const selector = (name) => keccak256(toBytes(`${name}()`)).slice(0, 10);

function pqPreview(mode, role, digest, leaf) {
  const args = ['contracts/pq/signer/signer.mjs', mode, role.toLowerCase(), digest];
  if (leaf !== undefined) args.push(String(leaf));
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, BELL_PQ_KEY_PROFILE: 'robinhood-4663', ...(mode === 'preview-reuse' ? { BELL_PQ_ALLOW_REUSE_PROOF: '1' } : {}) } });
  if (r.status !== 0) throw new Error(`PQ signer ${mode} failed: ${(r.stderr || '').trim()}`);
  return JSON.parse(r.stdout.trim());
}

async function state(role) {
  const id = roleHash(role);
  const [key, nonce] = await Promise.all([
    pc.readContract({ address: c.pqKeyRegistry, abi: registryAbi, functionName: 'roleKey', args: [id] }),
    pc.readContract({ address: c.hybridAuth, abi: authAbi, functionName: 'nonce', args: [id] }),
  ]);
  const [ecdsaSigner, publicKeyCommitment, maxStatefulSignatures, nextStatefulLeaf, keyVersion, installed] = key;
  return { id, key: { ecdsaSigner, publicKeyCommitment, maxStatefulSignatures, nextStatefulLeaf, keyVersion, installed }, nonce };
}

async function authorization({ role, target, action, payloadHash }) {
  const { id, key, nonce } = await state(role);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const message = { role: id, target, action, payloadHash, nonce, keyVersion: key.keyVersion, deadline };
  const digest = hashTypedData({ domain, types, primaryType: 'HybridAction', message });
  const onchain = await pc.readContract({ address: c.hybridAuth, abi: authAbi, functionName: 'actionDigest', args: [id, target, action, payloadHash, nonce, key.keyVersion, deadline] });
  if (digest.toLowerCase() !== onchain.toLowerCase()) throw new Error(`${role}: typed digest does not match the contract's`);
  const account = ecdsaKeys[role];
  if (account.address.toLowerCase() !== key.ecdsaSigner.toLowerCase()) throw new Error(`${role}: local ECDSA key is not the installed signer`);
  const ecdsa = await account.signTypedData({ domain, types, primaryType: 'HybridAction', message });
  return { digest, ecdsa, deadline, nextLeaf: key.nextStatefulLeaf };
}

const revertDataOf = (e) => { const w = e?.walk?.((x) => typeof x?.data === 'string' && x.data.startsWith('0x')); return w?.data ?? ''; };

async function attempt({ id, label, request, expect }) {
  let reverted = '';
  try { await pc.simulateContract({ ...request, account: sender }); } catch (e) { reverted = revertDataOf(e).slice(0, 10).toLowerCase(); }
  if (!reverted) throw new Error(`${id}: the call did not revert in simulation, so it will not be sent`);
  const names = Array.isArray(expect) ? expect : [expect];
  const hit = names.find((n) => selector(n) === reverted);
  if (!hit) throw new Error(`${id}: reverted with ${reverted}, expected ${names.join(' or ')}`);
  console.log(`${id} ${label}: simulation reverts with ${hit}`);
  if (!broadcast) return null;
  const { encodeFunctionData } = await import('viem');
  const hash = await wc.sendTransaction({ to: request.address, data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }), gas: 1_500_000n });
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== 'reverted') throw new Error(`${id}: expected a reverted transaction, got ${r.status}`);
  console.log(`${id} reverted on chain: ${hash} (block ${r.blockNumber})`);
  return { id, tx: hash, block: Number(r.blockNumber), status: r.status, error: hit, selector: selector(hit), gasUsed: Number(r.gasUsed) };
}

const queueAction = await pc.readContract({ address: c.safetyController, abi: scAbi, functionName: 'QUEUE_CALL_ACTION' });
const pauseAction = await pc.readContract({ address: c.safetyController, abi: scAbi, functionName: 'PAUSE_ACTION' });

// A real calendar-root queue call for NVDA. It is never executed: authorization fails before the controller looks at it.
const rootCall = buildCalendarRootGovernanceCall({
  calendarRegistry: c.calendarRegistry, assetId: nvdaState.assetId,
  metadata: { root: nvdaState.root, leafCount: nvdaState.leafCount, coverageStart: nvdaState.coverageStart, coverageEnd: nvdaState.coverageEnd, datasetHash: nvdaState.datasetHash },
});
const govBefore = await state('GOVERNANCE');
const guardBefore = await state('GUARDIAN');
console.log(`GOVERNANCE next leaf ${govBefore.key.nextStatefulLeaf}, GUARDIAN next leaf ${guardBefore.key.nextStatefulLeaf}`);

const queueRequest = (a, pqSignature) => ({ address: c.safetyController, abi: scAbi, functionName: 'queueGovernanceCall', args: [c.calendarRegistry, rootCall.callData, a.deadline, a.ecdsa, pqSignature] });
const results = [];
const gov = await authorization({ role: 'GOVERNANCE', target: c.safetyController, action: queueAction, payloadHash: rootCall.payloadHash });
const SIG_ERRORS = ['InvalidSignatureLength', 'InvalidPQSignature'];

// N1: valid ECDSA, no post-quantum signature at all.
results.push(await attempt({ id: 'N1', label: 'calendar root, ECDSA only', request: queueRequest(gov, '0x'), expect: SIG_ERRORS }));

// N2: valid ECDSA, and a real SHRINCS signature over the right digest, made with the GUARDIAN key instead of the GOVERNANCE key.
const wrongKey = pqPreview('preview', 'guardian', gov.digest);
results.push(await attempt({ id: 'N2', label: 'valid ECDSA, SHRINCS from the wrong key', request: queueRequest(gov, wrongKey.signature), expect: 'InvalidPQSignature' }));

// N3: the real GOVERNANCE key, at a leaf it has already spent (leaf 1 signed the AAPL calendar root).
const reused = pqPreview('preview-reuse', 'governance', gov.digest, 1);
results.push(await attempt({ id: 'N3', label: 'reused GOVERNANCE leaf 1', request: queueRequest(gov, reused.signature), expect: 'LeafOutOfOrder' }));

// N4: pause the first pool through SafetyControllerV2 with a valid GUARDIAN ECDSA signature and no post-quantum signature.
const pausePayload = keccak256(`0x${'00'.repeat(31)}01${pool.hook.slice(2).toLowerCase().padStart(64, '0')}`);
const pauseAuth = await authorization({ role: 'GUARDIAN', target: c.safetyController, action: pauseAction, payloadHash: pausePayload });
results.push(await attempt({ id: 'N4', label: 'pause with ECDSA only', request: { address: c.safetyController, abi: scAbi, functionName: 'pausePoolHybrid', args: [pool.hook, pauseAuth.deadline, pauseAuth.ecdsa, '0x'] }, expect: SIG_ERRORS }));

const govAfter = await state('GOVERNANCE');
const guardAfter = await state('GUARDIAN');
if (govAfter.key.nextStatefulLeaf !== govBefore.key.nextStatefulLeaf || guardAfter.key.nextStatefulLeaf !== guardBefore.key.nextStatefulLeaf
  || govAfter.nonce !== govBefore.nonce || guardAfter.nonce !== guardBefore.nonce) throw new Error('a rejected attempt changed leaf or nonce state');
console.log(`leaf counters unchanged: GOVERNANCE ${govAfter.key.nextStatefulLeaf}, GUARDIAN ${guardAfter.key.nextStatefulLeaf}`);

const done = results.filter(Boolean);
if (done.length) {
  const file = `${dir}/negatives.json`;
  let list = []; try { list = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none yet */ }
  writeFileSync(file, `${JSON.stringify([...list.filter((x) => !done.some((d) => d.id === x.id)), ...done], null, 2)}\n`);
  console.log(`wrote ${done.length} entries to ${file}`);
}
