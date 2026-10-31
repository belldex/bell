#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, decodeEventLog, http, keccak256, parseAbi, parseAbiItem, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildCounterassetDescriptor, validateCounterassetObservation } from './mainnet-counterasset-admission.mjs';

const MANIFEST_PATH = 'evidence/deploy/mainnet-4663.json';
const REVIEW_PATH = 'evidence/deploy/mainnet-4663-counterasset-meme-review.json';
const CANDIDATES_PATH = 'config/assets/counterassets.mainnet.json';
const STATE_PATH = 'evidence/deploy/mainnet-4663-counterasset-state.json';
const QUEUE_PATH = 'evidence/deploy/mainnet-4663-asset-queue.json';
const ZERO32 = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ASSET_ACTIVATED_EVENT = parseAbiItem('event AssetActivated(bytes32 indexed descriptorId,bytes32 evidenceHash)');
const TOKEN_ABI = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function owner() view returns (address)', 'function controller() view returns (address)',
  'function pool() view returns (address)', 'function isPoolLocked() view returns (bool)',
  'function isBalanceLimitActive() view returns (bool)', 'function balanceLimitEnd() view returns (uint48)',
  'function maxBalanceLimit() view returns (uint256)',
]);
const REGISTRY_ABI = parseAbi([
  'function queueAsset((bytes32 id,address token,bool isStock,uint8 decimals,uint8 capabilityMask,address tokenPriceAdapter,address regularAdapter,address extendedAdapter,address overnightAdapter,address secondaryAdapter,bytes32 expectedCodeHash,bytes32 implementationFingerprint,bytes32 evidenceHash) descriptor,bytes sourceConfig) returns (bytes32)',
  'function activateAsset(bytes32 operationId) returns (bytes32)',
  'function descriptorIdForToken(address token) view returns (bytes32)',
  'function descriptor(bytes32 id) view returns ((bytes32 id,address token,bool isStock,uint8 decimals,uint8 capabilityMask,address tokenPriceAdapter,address regularAdapter,address extendedAdapter,address overnightAdapter,address secondaryAdapter,bytes32 expectedCodeHash,bytes32 implementationFingerprint,bytes32 evidenceHash))',
  'function operation(bytes32 operationId) view returns (uint8 kind,bytes32 payloadHash,uint64 eta,uint64 expiry,uint8 status)',
  'event AssetQueued(bytes32 indexed operationId,bytes32 indexed descriptorId,uint64 eta)',
]);
const SAFETY_ABI = parseAbi([
  'function governance() view returns (address)',
  'function governanceDelaySeconds() view returns (uint64)',
  'function operationExpirySeconds() view returns (uint64)',
]);

function readDotEnv() {
  const values = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function saveJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function same(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
function isZero(value) { return same(value, ZERO32); }
function reviewEvidenceHash(reviewData) {
  const stable = { ...reviewData };
  delete stable.status;
  delete stable.admission;
  return keccak256(stringToHex(JSON.stringify(stable)));
}
function eip1167Implementation(code) {
  const match = String(code ?? '').match(/^0x3d3d3d3d363d3d37363d73([0-9a-f]{40})5af43d3d93803e602a57fd5bf3$/i);
  return match ? `0x${match[1]}` : null;
}
function nowIso(seconds) { return new Date(Number(seconds) * 1000).toISOString(); }

if (!existsSync(MANIFEST_PATH) || !existsSync(REVIEW_PATH) || !existsSync(CANDIDATES_PATH)) throw new Error('Mainnet deployment, reviewed MEME evidence, or counterasset candidate config is missing');
const manifest = readJson(MANIFEST_PATH);
const review = readJson(REVIEW_PATH);
const config = readJson(CANDIDATES_PATH);
if (Number(manifest.chainId) !== 4663 || Number(review.chainId) !== 4663 || Number(config.chainId) !== 4663) throw new Error('Counterasset admission is pinned to Robinhood Chain Mainnet (4663)');
const candidateRow = config.assets.find((asset) => asset.symbol === 'MEME');
if (!candidateRow) throw new Error('MEME candidate is not configured');
const tokenEvidence = review.token;
const candidate = {
  ...candidateRow, chainId: 4663,
  tokenCodeHash: tokenEvidence.runtimeCodeHash,
  implementation: tokenEvidence.implementationAddress,
  implementationCodeHash: tokenEvidence.implementationRuntimeCodeHash,
  evidenceHash: reviewEvidenceHash(review),
};
const env = readDotEnv();
const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
if (!rpcUrl) throw new Error('RH_MAINNET_RPC_PRIMARY is required');
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const chainId = await publicClient.getChainId();
if (chainId !== 4663) throw new Error(`Wrong chain ${chainId}; expected 4663`);
const block = await publicClient.getBlock();
const [tokenCode, implementationCode, registryDescriptorId, safetyGovernance, governanceDelay, operationExpiry] = await Promise.all([
  publicClient.getBytecode({ address: candidate.token }),
  publicClient.getBytecode({ address: candidate.implementation }),
  publicClient.readContract({ address: manifest.assetRegistry, abi: REGISTRY_ABI, functionName: 'descriptorIdForToken', args: [candidate.token] }),
  publicClient.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'governance' }),
  publicClient.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'governanceDelaySeconds' }),
  publicClient.readContract({ address: manifest.safetyController, abi: SAFETY_ABI, functionName: 'operationExpirySeconds' }),
]);
if (!tokenCode || !implementationCode) throw new Error('MEME token or its implementation has no Mainnet bytecode');
const observed = {
  ...await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'name' }).then(async (name) => ({
    name,
    symbol: await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'symbol' }),
    decimals: Number(await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'decimals' })),
    totalSupplyRaw: String(await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'totalSupply' })),
    owner: await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'owner' }),
    controller: await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'controller' }),
    poolLockActive: await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'isPoolLocked' }),
    poolLockTarget: await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'pool' }),
    balanceLimitActive: await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'isBalanceLimitActive' }),
    balanceLimitEnd: String(await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'balanceLimitEnd' })),
    maxBalanceLimit: String(await publicClient.readContract({ address: candidate.token, abi: TOKEN_ABI, functionName: 'maxBalanceLimit' })),
  })),
  chainId, token: candidate.token,
  tokenCodeHash: keccak256(tokenCode), implementation: eip1167Implementation(tokenCode),
  implementationCodeHash: keccak256(implementationCode), registryDescriptorId,
  clone: Boolean(eip1167Implementation(tokenCode)),
};
if (!same(observed.totalSupplyRaw, tokenEvidence.totalSupplyRaw)) throw new Error('MEME total supply does not match reviewed evidence; re-review before admission');
for (const field of ['owner', 'controller', 'poolLockActive', 'poolLockTarget', 'balanceLimitActive', 'balanceLimitEnd', 'maxBalanceLimit']) {
  if (!same(observed[field], review.observedTransferControls[field === 'poolLockActive' ? 'poolLockActive' : field === 'poolLockTarget' ? 'poolLockTarget' : field])) throw new Error(`MEME transfer-control state ${field} changed; re-review before admission`);
}
validateCounterassetObservation(candidate, observed, { allowAlreadyActive: !isZero(registryDescriptorId) });

const command = process.argv[2] ?? 'status';
const authorized = process.argv.includes('--i-authorize-spend');
const state = existsSync(STATE_PATH) ? readJson(STATE_PATH) : {};
const printStatus = async () => {
  const active = !isZero(registryDescriptorId);
  let activeDescriptor = null;
  if (active) {
    activeDescriptor = await publicClient.readContract({ address: manifest.assetRegistry, abi: REGISTRY_ABI, functionName: 'descriptor', args: [registryDescriptorId] });
    if (!same(activeDescriptor.token, candidate.token) || activeDescriptor.isStock || Number(activeDescriptor.decimals) !== 18
      || !same(activeDescriptor.expectedCodeHash, candidate.tokenCodeHash) || !same(activeDescriptor.evidenceHash, candidate.evidenceHash)
      || !same(activeDescriptor.tokenPriceAdapter, ZERO_ADDRESS) || !same(activeDescriptor.regularAdapter, ZERO_ADDRESS)
      || !same(activeDescriptor.extendedAdapter, ZERO_ADDRESS) || !same(activeDescriptor.overnightAdapter, ZERO_ADDRESS)
      || !same(activeDescriptor.secondaryAdapter, ZERO_ADDRESS)) throw new Error('Live MEME AssetRegistry descriptor does not match reviewed counterasset policy');
  }
  let pending = null;
  if (!active && state.operationId) {
    const op = await publicClient.readContract({ address: manifest.assetRegistry, abi: REGISTRY_ABI, functionName: 'operation', args: [state.operationId] });
    pending = { status: ['EMPTY', 'QUEUED', 'DONE', 'CANCELLED'][Number(op[4])], eta: String(op[2]), etaIso: nowIso(op[2]), expiry: String(op[3]), executableNow: block.timestamp >= op[2] && block.timestamp <= op[3] };
  }
  console.log(JSON.stringify({ chainId, blockNumber: String(block.number), token: candidate.token, name: observed.name, symbol: observed.symbol, decimals: observed.decimals, tokenCodeHash: observed.tokenCodeHash, implementation: observed.implementation, implementationCodeHash: observed.implementationCodeHash, registryDescriptorId, active, pending, governance: safetyGovernance, governanceDelaySeconds: String(governanceDelay), operationExpirySeconds: String(operationExpiry), allowedPoolClass: 'SESSION_ONLY', evidenceHash: candidate.evidenceHash }, null, 2));
};

if (command === 'status') {
  await printStatus();
} else if (command === 'queue' || command === 'activate') {
  const privateKey = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) throw new Error('Mainnet deployer key is required for counterasset governance operations');
  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  if (!same(account.address, safetyGovernance)) throw new Error('Configured signer is not the live SafetyController governance address');
  const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
  const simulateAndMaybeSend = async (request, label) => {
    const simulation = await publicClient.simulateContract({ ...request, account });
    const [gas, gasPrice, balance] = await Promise.all([
      publicClient.estimateContractGas({ ...request, account }), publicClient.getGasPrice(), publicClient.getBalance({ address: account.address }),
    ]);
    if (balance < gas * gasPrice) throw new Error(`${label} signer cannot cover the estimated transaction gas`);
    if (!authorized) throw new Error(`${label} simulation passed; append --i-authorize-spend to broadcast this reviewed governance operation`);
    const hash = await walletClient.writeContract(simulation.request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
    console.log(`${label} confirmed: ${hash} at block ${receipt.blockNumber}`);
    return receipt;
  };
  if (command === 'queue') {
    if (!isZero(registryDescriptorId)) {
      await printStatus();
    } else if (state.operationId) {
      const op = await publicClient.readContract({ address: manifest.assetRegistry, abi: REGISTRY_ABI, functionName: 'operation', args: [state.operationId] });
      if (Number(op[4]) !== 1) throw new Error('Saved counterasset operation is no longer pending; run status and reconcile before queueing');
      console.log(`MEME admission already queued; operation ${state.operationId}, ETA ${nowIso(op[2])}`);
    } else {
      const descriptor = buildCounterassetDescriptor(candidate);
      const receipt = await simulateAndMaybeSend({ address: manifest.assetRegistry, abi: REGISTRY_ABI, functionName: 'queueAsset', args: [descriptor, '0x'] }, 'MEME queueAsset');
      const event = receipt.logs.map((log) => { try { return decodeEventLog({ abi: REGISTRY_ABI, data: log.data, topics: log.topics }); } catch { return null; } }).find((entry) => entry?.eventName === 'AssetQueued');
      if (!event) throw new Error('AssetQueued event is missing from the successful receipt');
      const [, , eta] = event.args;
      const next = { chainId, registryAddress: manifest.assetRegistry, token: candidate.token, evidenceHash: candidate.evidenceHash, operationId: event.args.operationId, descriptorId: event.args.descriptorId, txHash: receipt.transactionHash, queuedAtBlock: String(receipt.blockNumber), eta: String(eta), status: 'QUEUED' };
      saveJson(STATE_PATH, next);
      console.log(`MEME activation ETA: ${nowIso(eta)}; queue evidence saved to ${STATE_PATH}`);
    }
  } else {
    if (!state.operationId || !same(state.registryAddress, manifest.assetRegistry) || !same(state.evidenceHash, candidate.evidenceHash)) throw new Error('No matching reviewed MEME queue operation is saved; run queue first');
    const op = await publicClient.readContract({ address: manifest.assetRegistry, abi: REGISTRY_ABI, functionName: 'operation', args: [state.operationId] });
    let receipt;
    if (Number(op[4]) === 1) {
      if (block.timestamp < op[2]) throw new Error(`MEME cannot be activated before ${nowIso(op[2])}`);
      if (block.timestamp > op[3]) throw new Error(`MEME queue operation expired at ${nowIso(op[3])}`);
      receipt = await simulateAndMaybeSend({ address: manifest.assetRegistry, abi: REGISTRY_ABI, functionName: 'activateAsset', args: [state.operationId] }, 'MEME activateAsset');
    } else if (Number(op[4]) === 2) {
      const lastBlock = await publicClient.getBlockNumber();
      const ranges = [];
      for (let from = BigInt(state.queuedAtBlock); from <= lastBlock; from += 10n) ranges.push([from, from + 9n < lastBlock ? from + 9n : lastBlock]);
      const activations = (await Promise.all(ranges.map(([fromBlock, toBlock]) => publicClient.getLogs({
        address: manifest.assetRegistry, event: ASSET_ACTIVATED_EVENT,
        args: { descriptorId: state.descriptorId, evidenceHash: candidate.evidenceHash }, fromBlock, toBlock,
      })))).flat();
      const activation = activations.at(-1);
      if (!activation) throw new Error('Operation is already DONE but its matching AssetActivated receipt is not indexed');
      receipt = await publicClient.getTransactionReceipt({ hash: activation.transactionHash });
      if (receipt.status !== 'success') throw new Error('Recorded AssetActivated transaction did not succeed');
      console.log(`Recovered prior MEME activation receipt: ${receipt.transactionHash}`);
    } else throw new Error(`MEME queue operation status is ${Number(op[4])}, expected QUEUED or DONE`);
    const descriptorId = await publicClient.readContract({ address: manifest.assetRegistry, abi: REGISTRY_ABI, functionName: 'descriptorIdForToken', args: [candidate.token] });
    const descriptor = await publicClient.readContract({ address: manifest.assetRegistry, abi: REGISTRY_ABI, functionName: 'descriptor', args: [descriptorId] });
    if (!same(descriptor.token, candidate.token) || descriptor.isStock || Number(descriptor.decimals) !== 18
      || !same(descriptor.tokenPriceAdapter, ZERO_ADDRESS) || !same(descriptor.regularAdapter, ZERO_ADDRESS)
      || !same(descriptor.extendedAdapter, ZERO_ADDRESS) || !same(descriptor.overnightAdapter, ZERO_ADDRESS)
      || !same(descriptor.secondaryAdapter, ZERO_ADDRESS) || !same(descriptor.expectedCodeHash, candidate.tokenCodeHash)
      || !same(descriptor.evidenceHash, candidate.evidenceHash)) throw new Error('Activated MEME descriptor violates the reviewed SESSION_ONLY counterasset policy');
    state.status = 'ACTIVE'; state.descriptorId = descriptorId; state.activationHash = receipt.transactionHash; state.activatedAtBlock = String(receipt.blockNumber);
    saveJson(STATE_PATH, state);
    const queue = readJson(QUEUE_PATH);
    queue.counterassets = queue.counterassets ?? {};
    queue.counterassets.MEME = { symbol: 'MEME', name: 'A Meme Coin', token: candidate.token, descriptorId, isStock: false, decimals: 18, evidenceHash: candidate.evidenceHash, allowedPoolClass: 'SESSION_ONLY', active: true };
    queue.activationPending = false;
    queue.activatedAt = new Date().toISOString();
    saveJson(QUEUE_PATH, queue);
    review.status = 'ADMITTED'; review.admission = { descriptorId, queueTxHash: state.txHash, activationTxHash: receipt.transactionHash, activatedAtBlock: String(receipt.blockNumber) };
    saveJson(REVIEW_PATH, review);
    config.status = 'ACTIVE_COUNTERASSETS';
    candidateRow.descriptorId = descriptorId; candidateRow.evidenceHash = candidate.evidenceHash; candidateRow.active = true;
    saveJson(CANDIDATES_PATH, config);
    console.log(`MEME is ACTIVE with descriptor ${descriptorId}; Create UI can now offer SESSION_ONLY.`);
  }
} else {
  throw new Error('Use status | queue | activate');
}
