import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  createPublicClient, createWalletClient, decodeAbiParameters, defineChain,
  encodeAbiParameters, hashTypedData, http, keccak256, parseAbi,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { privateKeyToAccount as accountFromKey } from 'viem/accounts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const base = path.join(repo, 'contracts/pq');
const rpcUrl = process.env.BELL_PQ_RPC_URL || 'https://rpc-elysium-testnet.t.conduit.xyz';
const chain = defineChain({ id: 99801, name: 'Elysium Testnet', nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });

function parseEnv(file) {
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    return m ? [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')] : null;
  }).filter(Boolean));
}
const contractsEnv = parseEnv(path.join(repo, 'contracts/.env'));
const rootEnv = parseEnv(path.join(repo, '.env'));
const normalizeKey = (value) => `0x${value.replace(/^0x/, '')}`;
const deployer = privateKeyToAccount(normalizeKey(contractsEnv.ELYSIUM_DEPLOYER_PRIVATE_KEY));
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
const manifest = JSON.parse(await readFile(path.join(base, 'deployments/elysium-99801.json'), 'utf8'));
const evidencePath = path.join(repo, 'evidence/pq/elysium-99801/hybrid-inputs.json');
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
const authAbi = JSON.parse(await readFile(path.join(repo, 'contracts/out-pq/HybridAuth.sol/HybridAuth.json'), 'utf8')).abi;
const registryAbi = JSON.parse(await readFile(path.join(repo, 'contracts/out-pq/PQKeyRegistry.sol/PQKeyRegistry.json'), 'utf8')).abi;
const trustErrorsAbi = parseAbi(['error LeafOutOfOrder()', 'error InvalidPQSignature()']);
const domain = { name: 'BELL HybridAuth', version: '1', chainId: 99801, verifyingContract: manifest.contracts.hybridAuth };
const types = { HybridAction: [
  { name: 'role', type: 'bytes32' }, { name: 'target', type: 'address' },
  { name: 'action', type: 'bytes32' }, { name: 'payloadHash', type: 'bytes32' },
  { name: 'nonce', type: 'uint256' }, { name: 'keyVersion', type: 'uint32' },
  { name: 'deadline', type: 'uint256' },
] };
const envelopeAbi = [
  { type: 'tuple', components: [{ type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }] },
  { type: 'tuple', components: [{ type: 'bytes32' }, { type: 'uint32' }, { type: 'bytes32[]' }, { type: 'bytes32[]' }] },
];
const roleHash = (name) => keccak256(toBytes(name));

function signer(role, digest, mode = 'preview', leafIndex) {
  const args = [path.join(here, 'signer.mjs'), mode, role.toLowerCase(), digest];
  if (leafIndex !== undefined) args.push(String(leafIndex));
  const env = { ...process.env };
  if (mode === 'preview-reuse') env.BELL_PQ_ALLOW_REUSE_PROOF = '1';
  const res = spawnSync(process.execPath, args, { encoding: 'utf8', env });
  if (res.status !== 0) throw new Error(res.stderr || `PQ signer failed for ${role}.`);
  return JSON.parse(res.stdout.trim());
}

function corruptRandomizer(envelope) {
  const [publicKey, signature] = decodeAbiParameters(envelopeAbi, envelope);
  const randomizer = signature[0];
  signature[0] = `0x${randomizer.slice(2, 4) === '00' ? '01' : '00'}${randomizer.slice(4)}`;
  return encodeAbiParameters(envelopeAbi, [publicKey, signature]);
}

function revertData(error) {
  if (typeof error?.data === 'string' && error.data.startsWith('0x')) return error.data;
  return revertData(error?.cause);
}

async function simulateAndDecode(request, expectedError, label) {
  try {
    await publicClient.simulateContract(request);
    throw new Error(`${label}: expected ${expectedError} but call simulated successfully.`);
  } catch (error) {
    if (error.message?.includes('simulated successfully')) throw error;
    const data = revertData(error);
    if (!data) throw new Error(`${label}: simulation failed without revert data (${error.shortMessage || error.message}).`);
    const decoded = data.slice(0, 10);
    const wanted = keccak256(toBytes(`${expectedError}()`)).slice(0, 10);
    if (decoded.toLowerCase() !== wanted.toLowerCase()) {
      throw new Error(`${label}: expected ${expectedError}, got selector ${decoded}.`);
    }
    return decoded;
  }
}

async function prove({ label, role, target, action, payloadHash, ecdsaKey, call }) {
  const roleId = roleHash(role);
  const key = await publicClient.readContract({ address: manifest.contracts.pqKeyRegistry, abi: registryAbi, functionName: 'roleKey', args: [roleId] });
  const nonce = await publicClient.readContract({ address: manifest.contracts.hybridAuth, abi: authAbi, functionName: 'nonce', args: [roleId] });
  if (key.nextStatefulLeaf !== 2 || nonce !== 1n) throw new Error(`${label}: unexpected starting one-time state.`);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const message = { role: roleId, target, action, payloadHash, nonce, keyVersion: key.keyVersion, deadline };
  const digest = hashTypedData({ domain, types, primaryType: 'HybridAction', message });
  const onchainDigest = await publicClient.readContract({ address: manifest.contracts.hybridAuth, abi: authAbi, functionName: 'actionDigest', args: [roleId, target, action, payloadHash, nonce, key.keyVersion, deadline] });
  if (digest.toLowerCase() !== onchainDigest.toLowerCase()) throw new Error(`${label}: typed digest mismatch.`);
  const ecdsa = await accountFromKey(normalizeKey(ecdsaKey)).signTypedData({ domain, types, primaryType: 'HybridAction', message });

  const reused = signer(role, digest, 'preview-reuse', 1);
  const reuseRequest = { ...call(reused.signature, ecdsa, deadline), account: deployer };
  await simulateAndDecode(reuseRequest, 'LeafOutOfOrder', `${label} reused leaf`);
  const reusedTx = await walletClient.writeContract({ ...reuseRequest, gas: 1_200_000n });
  const reusedReceipt = await publicClient.waitForTransactionReceipt({ hash: reusedTx });
  if (reusedReceipt.status !== 'reverted') throw new Error(`${label}: reused leaf transaction was not rejected.`);

  const nextLeafSignature = signer(role, digest, 'preview');
  const invalidPq = corruptRandomizer(nextLeafSignature.signature);
  const badPqRequest = { ...call(invalidPq, ecdsa, deadline), account: deployer };
  await simulateAndDecode(badPqRequest, 'InvalidPQSignature', `${label} invalid PQ`);
  const badPqTx = await walletClient.writeContract({ ...badPqRequest, gas: 1_200_000n });
  const badPqReceipt = await publicClient.waitForTransactionReceipt({ hash: badPqTx });
  if (badPqReceipt.status !== 'reverted') throw new Error(`${label}: invalid PQ signature transaction was not rejected.`);

  const afterNonce = await publicClient.readContract({ address: manifest.contracts.hybridAuth, abi: authAbi, functionName: 'nonce', args: [roleId] });
  const afterKey = await publicClient.readContract({ address: manifest.contracts.pqKeyRegistry, abi: registryAbi, functionName: 'roleKey', args: [roleId] });
  if (afterNonce !== 1n || afterKey.nextStatefulLeaf !== 2) throw new Error(`${label}: rejected attempts mutated nonce or leaf state.`);

  return {
    label, role, nonce: '1', expectedNextLeaf: 2,
    reusedLeaf: { leafIndex: reused.leafIndex, txHash: reusedTx, status: reusedReceipt.status, gasUsed: reusedReceipt.gasUsed.toString(), block: reusedReceipt.blockNumber.toString(), error: 'LeafOutOfOrder' },
    invalidPq: { leafIndex: nextLeafSignature.leafIndex, txHash: badPqTx, status: badPqReceipt.status, gasUsed: badPqReceipt.gasUsed.toString(), block: badPqReceipt.blockNumber.toString(), error: 'InvalidPQSignature' },
  };
}

const block = await publicClient.getBlock();
const now = BigInt(block.timestamp);
const until = now + 86400n;
const root2 = keccak256(toBytes('BELL PQ rejection proof calendar root'));
const calendarArgs = [root2, now, until];
const calendarHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint64' }, { type: 'uint64' }], calendarArgs));
const calendarAction = await publicClient.readContract({ address: manifest.contracts.calendarRegistryV2, abi: parseAbi(['function UPDATE_ROOT_ACTION() view returns(bytes32)']), functionName: 'UPDATE_ROOT_ACTION' });

const poolId = keccak256(toBytes('BELL_PQ_TESTNET_POOL'));
const anchor2 = keccak256(toBytes('BELL_PQ_TESTNET_CLOSE_ANCHOR_2'));
const sessionArgs = [poolId, 2n, anchor2];
const sessionHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes32' }], sessionArgs));
const sessionAction = await publicClient.readContract({ address: manifest.contracts.sessionRegistryV2, abi: parseAbi(['function SET_CLOSE_ANCHOR_ACTION() view returns(bytes32)']), functionName: 'SET_CLOSE_ANCHOR_ACTION' });

const assetId = keccak256(toBytes('AAPL'));
const price = 22_736_000000n;
const observedAt = now;
const priceArgs = [assetId, price, observedAt];
const priceHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint128' }, { type: 'uint64' }], priceArgs));
const priceAction = await publicClient.readContract({ address: manifest.contracts.priceAttestationAdapter, abi: parseAbi(['function ATTEST_PRICE_ACTION() view returns(bytes32)']), functionName: 'ATTEST_PRICE_ACTION' });

const proofs = [];
proofs.push(await prove({
  label: 'calendar-root', role: 'GOVERNANCE', target: manifest.contracts.calendarRegistryV2, action: calendarAction, payloadHash: calendarHash,
  ecdsaKey: contractsEnv.ELYSIUM_DEPLOYER_PRIVATE_KEY,
  call: (pq, sig, deadline) => ({ address: manifest.contracts.calendarRegistryV2, abi: parseAbi(['function updateRoot(bytes32,uint64,uint64,uint256,bytes,bytes)']), functionName: 'updateRoot', args: [root2, now, until, deadline, sig, pq] }),
}));
proofs.push(await prove({
  label: 'close-anchor', role: 'KEEPER', target: manifest.contracts.sessionRegistryV2, action: sessionAction, payloadHash: sessionHash,
  ecdsaKey: rootEnv.KEEPER_A_PRIVATE_KEY,
  call: (pq, sig, deadline) => ({ address: manifest.contracts.sessionRegistryV2, abi: parseAbi(['function setCloseAnchor(bytes32,uint64,bytes32,uint256,bytes,bytes)']), functionName: 'setCloseAnchor', args: [poolId, 2n, anchor2, deadline, sig, pq] }),
}));
proofs.push(await prove({
  label: 'price-attestation', role: 'REPORTER', target: manifest.contracts.priceAttestationAdapter, action: priceAction, payloadHash: priceHash,
  ecdsaKey: contractsEnv.ELYSIUM_REPORTER_PRIVATE_KEY,
  call: (pq, sig, deadline) => ({ address: manifest.contracts.priceAttestationAdapter, abi: parseAbi(['function attestPrice(bytes32,uint128,uint64,uint256,bytes,bytes)']), functionName: 'attestPrice', args: [assetId, price, observedAt, deadline, sig, pq] }),
}));

evidence.negativeProofs = proofs;
evidence.verifiedStateAt = (await publicClient.getBlock()).number.toString();
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(proofs, null, 2));
