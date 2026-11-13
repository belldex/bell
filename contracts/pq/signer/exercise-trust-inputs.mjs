import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  createPublicClient, createWalletClient, defineChain, encodeAbiParameters,
  http, keccak256, parseAbi, toBytes, hashTypedData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const manifestPath = path.join(repo, 'contracts/pq/deployments/elysium-99801.json');
const logDir = path.join(repo, 'evidence/pq/elysium-99801');
const rpcUrl = 'https://testnet-rpc.elysium.kinetiq.xyz';
const chain = defineChain({
  id: 99801,
  name: 'Elysium Testnet',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

function envFile(file) {
  const raw = readFileSync(file, 'utf8');
  return Object.fromEntries(raw.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    return match ? [match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')] : null;
  }).filter(Boolean));
}

const contractsEnv = envFile(path.join(repo, 'contracts/.env'));
const rootEnv = envFile(path.join(repo, '.env'));
const deployerKey = `0x${contractsEnv.ELYSIUM_DEPLOYER_PRIVATE_KEY.replace(/^0x/, '')}`;
const deployer = privateKeyToAccount(deployerKey);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const authArtifact = JSON.parse(await readFile(path.join(repo, 'contracts/out-pq/HybridAuth.sol/HybridAuth.json'), 'utf8'));
const registryArtifact = JSON.parse(await readFile(path.join(repo, 'contracts/out-pq/PQKeyRegistry.sol/PQKeyRegistry.json'), 'utf8'));
const authAbi = authArtifact.abi;
const registryAbi = registryArtifact.abi;
const calendarAbi = parseAbi([
  'function UPDATE_ROOT_ACTION() view returns (bytes32)',
  'function updateRoot(bytes32 root,uint64 nextValidFrom,uint64 nextValidUntil,uint256 deadline,bytes ecdsaSignature,bytes pqSignature)',
  'function currentRoot() view returns(bytes32)',
]);
const sessionAbi = parseAbi([
  'function SET_CLOSE_ANCHOR_ACTION() view returns (bytes32)',
  'function setCloseAnchor(bytes32 poolId,uint64 cycle,bytes32 anchor,uint256 deadline,bytes ecdsaSignature,bytes pqSignature)',
  'function closeAnchor(bytes32 poolId) view returns(uint64 cycle,bytes32 value)',
]);
const priceAbi = parseAbi([
  'function ATTEST_PRICE_ACTION() view returns (bytes32)',
  'function attestPrice(bytes32 assetId,uint128 price,uint64 observedAt,uint256 deadline,bytes ecdsaSignature,bytes pqSignature)',
  'function latestPrice(bytes32 assetId) view returns(uint128 price,uint64 observedAt,uint64 sequence)',
]);

const roleName = (name) => keccak256(toBytes(name));
const hybridTypes = {
  HybridAction: [
    { name: 'role', type: 'bytes32' },
    { name: 'target', type: 'address' },
    { name: 'action', type: 'bytes32' },
    { name: 'payloadHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'keyVersion', type: 'uint32' },
    { name: 'deadline', type: 'uint256' },
  ],
};
const normalizePrivateKey = (key) => `0x${key.replace(/^0x/, '')}`;

function runPQSigner(role, digest, mode = 'sign') {
  const result = spawnSync(process.execPath, [path.join(here, 'signer.mjs'), mode, role.toLowerCase(), digest], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'PQ signer failed.');
  return JSON.parse(result.stdout.trim());
}

async function attest({ label, role, action, target, payloadHash, call, ecdsaKey }) {
  const roleHash = roleName(role);
  const key = await publicClient.readContract({ address: manifest.contracts.pqKeyRegistry, abi: registryAbi, functionName: 'roleKey', args: [roleHash] });
  const nonce = await publicClient.readContract({ address: manifest.contracts.hybridAuth, abi: authAbi, functionName: 'nonce', args: [roleHash] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const typedData = {
    domain: { name: 'BELL HybridAuth', version: '1', chainId: chain.id, verifyingContract: manifest.contracts.hybridAuth },
    types: hybridTypes,
    primaryType: 'HybridAction',
    message: { role: roleHash, target, action, payloadHash, nonce, keyVersion: key.keyVersion, deadline },
  };
  const digest = hashTypedData(typedData);
  const contractDigest = await publicClient.readContract({
    address: manifest.contracts.hybridAuth,
    abi: authAbi,
    functionName: 'actionDigest',
    args: [roleHash, target, action, payloadHash, nonce, key.keyVersion, deadline],
  });
  if (digest.toLowerCase() !== contractDigest.toLowerCase()) throw new Error(`EIP-712 digest mismatch for ${label}.`);
  const preview = runPQSigner(role, digest, 'preview');
  const ecdsa = await privateKeyToAccount(normalizePrivateKey(ecdsaKey)).signTypedData(typedData);
  const corrupted = `0x${(ecdsa.slice(2, 2 + 64) === '00'.repeat(32) ? '01' : '00')}${ecdsa.slice(4)}`;
  try {
    await publicClient.simulateContract({ ...call(preview.signature, corrupted, deadline), account: deployer });
    throw new Error(`Invalid ECDSA signature unexpectedly simulated successfully: ${label}`);
  } catch (error) {
    if (error.message?.includes('unexpectedly simulated successfully')) throw error;
  }
  await publicClient.simulateContract({ ...call(preview.signature, ecdsa, deadline), account: deployer });
  const signed = runPQSigner(role, digest, 'sign');
  if (signed.leafIndex !== preview.leafIndex || signed.signature !== preview.signature) {
    throw new Error(`Persisted one-time signature differed from preview for ${label}.`);
  }
  const failedHash = await walletClient.writeContract({ ...call(signed.signature, corrupted, deadline), account: deployer, gas: 1_200_000n });
  const failedReceipt = await publicClient.waitForTransactionReceipt({ hash: failedHash });
  if (failedReceipt.status !== 'reverted') throw new Error(`Invalid hybrid action unexpectedly succeeded: ${label}`);

  const successHash = await walletClient.writeContract({ ...call(signed.signature, ecdsa, deadline), account: deployer, gas: 1_200_000n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: successHash });
  if (receipt.status !== 'success') throw new Error(`Valid hybrid action reverted: ${label}`);
  return {
    label, role, leafIndex: signed.leafIndex,
    rejected: { txHash: failedHash, status: failedReceipt.status, gasUsed: failedReceipt.gasUsed.toString(), block: failedReceipt.blockNumber.toString() },
    accepted: { txHash: successHash, status: receipt.status, gasUsed: receipt.gasUsed.toString(), block: receipt.blockNumber.toString() },
    digest,
  };
}

const latest = await publicClient.getBlock();
const start = BigInt(latest.timestamp);
const until = start + 86_400n;
const calendarRoot = keccak256(toBytes('BELL Elysium testnet hybrid calendar proof 2026-11-13'));
const calendarPayload = keccak256(encodeAbiParameters(
  [{ type: 'bytes32' }, { type: 'uint64' }, { type: 'uint64' }],
  [calendarRoot, start, until],
));
const calendarAction = await publicClient.readContract({ address: manifest.contracts.calendarRegistryV2, abi: calendarAbi, functionName: 'UPDATE_ROOT_ACTION' });

const poolId = keccak256(toBytes('BELL_PQ_TESTNET_POOL'));
const anchor = keccak256(toBytes('BELL_PQ_TESTNET_CLOSE_ANCHOR_1'));
const cycle = 1n;
const sessionPayload = keccak256(encodeAbiParameters(
  [{ type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes32' }],
  [poolId, cycle, anchor],
));
const sessionAction = await publicClient.readContract({ address: manifest.contracts.sessionRegistryV2, abi: sessionAbi, functionName: 'SET_CLOSE_ANCHOR_ACTION' });

const assetId = keccak256(toBytes('AAPL'));
const price = 22_735_000000n;
const observedAt = BigInt(latest.timestamp);
const pricePayload = keccak256(encodeAbiParameters(
  [{ type: 'bytes32' }, { type: 'uint128' }, { type: 'uint64' }],
  [assetId, price, observedAt],
));
const priceAction = await publicClient.readContract({ address: manifest.contracts.priceAttestationAdapter, abi: priceAbi, functionName: 'ATTEST_PRICE_ACTION' });

const results = [];
results.push(await attest({
  label: 'calendar-root', role: 'GOVERNANCE', action: calendarAction,
  target: manifest.contracts.calendarRegistryV2, payloadHash: calendarPayload,
  ecdsaKey: contractsEnv.ELYSIUM_DEPLOYER_PRIVATE_KEY,
  call: (pqSignature, ecdsaSignature, deadline) => ({
    address: manifest.contracts.calendarRegistryV2, abi: calendarAbi, functionName: 'updateRoot',
    args: [calendarRoot, start, until, deadline, ecdsaSignature, pqSignature],
  }),
}));
results.push(await attest({
  label: 'close-anchor', role: 'KEEPER', action: sessionAction,
  target: manifest.contracts.sessionRegistryV2, payloadHash: sessionPayload,
  ecdsaKey: rootEnv.KEEPER_A_PRIVATE_KEY,
  call: (pqSignature, ecdsaSignature, deadline) => ({
    address: manifest.contracts.sessionRegistryV2, abi: sessionAbi, functionName: 'setCloseAnchor',
    args: [poolId, cycle, anchor, deadline, ecdsaSignature, pqSignature],
  }),
}));
results.push(await attest({
  label: 'price-attestation', role: 'REPORTER', action: priceAction,
  target: manifest.contracts.priceAttestationAdapter, payloadHash: pricePayload,
  ecdsaKey: contractsEnv.ELYSIUM_REPORTER_PRIVATE_KEY,
  call: (pqSignature, ecdsaSignature, deadline) => ({
    address: manifest.contracts.priceAttestationAdapter, abi: priceAbi, functionName: 'attestPrice',
    args: [assetId, price, observedAt, deadline, ecdsaSignature, pqSignature],
  }),
}));

const calendarStored = await publicClient.readContract({ address: manifest.contracts.calendarRegistryV2, abi: calendarAbi, functionName: 'currentRoot' });
const [storedCycle, storedAnchor] = await publicClient.readContract({ address: manifest.contracts.sessionRegistryV2, abi: sessionAbi, functionName: 'closeAnchor', args: [poolId] });
const [storedPrice, storedAt, sequence] = await publicClient.readContract({ address: manifest.contracts.priceAttestationAdapter, abi: priceAbi, functionName: 'latestPrice', args: [assetId] });
if (calendarStored.toLowerCase() !== calendarRoot.toLowerCase() || storedCycle !== cycle || storedAnchor.toLowerCase() !== anchor.toLowerCase() || storedPrice !== price || storedAt !== observedAt || sequence !== 1n) {
  throw new Error('On-chain trust-input state did not match submitted testnet payloads.');
}

await mkdir(logDir, { recursive: true });
const evidence = {
  chainId: 99801,
  profile: 'shrincs-256s-keccak-stateful',
  verifiedStateAt: (await publicClient.getBlock()).number.toString(),
  syntheticPriceNotice: 'AAPL test value is deterministic test data, not a market quote.',
  inputs: {
    calendar: { root: calendarRoot, validFrom: start.toString(), validUntil: until.toString(), epoch: 1 },
    closeAnchor: { poolId, cycle: cycle.toString(), anchor },
    price: { assetId, value: price.toString(), observedAt: observedAt.toString(), sequence: 1 },
  },
  results,
  verified: { calendarRoot: calendarStored, closeAnchor: storedAnchor, closeCycle: storedCycle.toString(), price: storedPrice.toString(), priceObservedAt: storedAt.toString(), priceSequence: sequence.toString() },
};
const evidencePath = path.join(logDir, 'hybrid-inputs.json');
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify(evidence, null, 2));
