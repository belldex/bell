#!/usr/bin/env node
/**
 * Rehearses the ANT onboarding on Robinhood testnet (46630) with the Einstein stack that is already deployed there. The testnet has no
 * ANT token and no Chainlink feed, so this deploys a test ANT token, a fixture feed and the four source adapters, then admits the asset
 * the way mainnet will have to: AFTER genesis, through a hybrid-signed (ECDSA + SHRINCS) governance call to AssetRegistry.queueAsset,
 * then executeGovernanceCall, then activateAsset. That post-genesis path has not been exercised on mainnet yet, which is the point.
 *
 *   node scripts/einstein/ant-testnet-admit.mjs plan
 *   node scripts/einstein/ant-testnet-admit.mjs run --broadcast
 *
 * Output: evidence/deploy/testnet-46630-ant.json. On mainnet the token is Robinhood's real ANT and the feed is Chainlink's; only the
 * feed address and the deployer change.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, parseEventLogs, parseUnits, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import TokenArtifact from '../../contracts/out/TestToken.sol/TestToken.json' with { type: 'json' };
import FeedArtifact from '../../contracts/out/MockChainlinkFeed.sol/MockChainlinkFeed.json' with { type: 'json' };
import AggregatorArtifact from '../../contracts/out/AggregatorAdapter.sol/AggregatorAdapter.json' with { type: 'json' };
import SessionArtifact from '../../contracts/out/ChainlinkEquitySessionAdapter.sol/ChainlinkEquitySessionAdapter.json' with { type: 'json' };
import DelegatedArtifact from '../../contracts/out/DelegatedAttestedSourceAdapter.sol/DelegatedAttestedSourceAdapter.json' with { type: 'json' };
import RegistryArtifact from '../../contracts/out/AssetRegistry.sol/AssetRegistry.json' with { type: 'json' };
import { canonicalTokenId } from '../../packages/protocol/src/identity.mjs';
import { buildChainlinkSessionPlan } from '../deploy/mainnet-chainlink-session-plan.mjs';
import { GOVERNANCE_ROLE, QUEUE_GOVERNANCE_CALL_ACTION } from '../deploy/mainnet-calendar-hybrid-lib.mjs';

const NETWORK = process.argv.includes('--network') ? process.argv[process.argv.indexOf('--network') + 1] : 'testnet';
const MAINNET = NETWORK === 'mainnet';
const CHAIN_ID = MAINNET ? 4663 : 46630;
const ANT_MAINNET = '0xbbB6c29bCc3a1028A2B54310DF73F4F7A3bcB373'; // Robinhood's ANT, from docs.robinhood.com/chain/contracts and the rhj assets API
const MODE = process.argv.includes('--source') ? process.argv[process.argv.indexOf('--source') + 1] : 'fixture'; // fixture: Chainlink-shaped fixture feed; delegated: BELL-attested price source
const OUT = MAINNET ? 'evidence/deploy/mainnet-4663-ant.json' : MODE === 'delegated' ? 'evidence/deploy/testnet-46630-ant-delegated.json' : 'evidence/deploy/testnet-46630-ant.json';
const command = process.argv[2] ?? 'plan';
const broadcast = process.argv.includes('--broadcast');
const env = {}; for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
if (MAINNET && MODE !== 'delegated') throw new Error('mainnet needs --source delegated: there is no Chainlink ANT feed and no fixture feed on mainnet');
if (MAINNET && broadcast && !process.argv.includes('--i-authorize-spend')) throw new Error('a mainnet broadcast needs --broadcast --i-authorize-spend');
const rpc = MAINNET ? env.RH_MAINNET_RPC_PRIMARY : env.RH_TESTNET_RPC_PRIMARY;
const pk = MAINNET ? (env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY) : env.DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const pc = createPublicClient({ transport: http(rpc) });
const wc = createWalletClient({ account, transport: http(rpc) });
if (await pc.getChainId() !== CHAIN_ID) throw new Error(`RPC is not chain ${CHAIN_ID}`);
const manifest = JSON.parse(readFileSync(MAINNET ? 'evidence/deploy/pq-hooks-mainnet.json' : 'evidence/deploy/pq-hooks-testnet-46630.json', 'utf8'));
const c = manifest.contracts;
const state = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { chainId: CHAIN_ID, note: MAINNET ? 'ANT on Robinhood mainnet with the delegated-attestation price source.' : 'Testnet rehearsal of the ANT onboarding. Test token, fixture feed.', txs: {} };
const save = () => writeFileSync(OUT, `${JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`);
const wait = async (hash, what) => { const r = await pc.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw new Error(`${what} failed ${hash}`); return r; };
const codeOf = async (address) => { for (let i = 0; i < 30; i += 1) { const x = await pc.getBytecode({ address }); if (x && x.length > 2) return x; await new Promise((r) => setTimeout(r, 2000)); } throw new Error(`no code at ${address}`); };
const deploy = async (what, artifact, args) => { const hash = await wc.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args }); const r = await wait(hash, what); console.log(what, r.contractAddress); state.txs[what] = hash; save(); return r.contractAddress; };

console.log(JSON.stringify({ network: NETWORK, mode: broadcast ? 'BROADCAST' : 'PLAN', deployer: account.address, assetRegistry: c.assetRegistry, safetyController: c.safetyController, state: Object.keys(state) }, null, 2));
if (command === 'plan' || !broadcast) {
  if (MAINNET || process.argv.includes('--estimate')) {
    // Read-only: the token, the hybrid auth and the gas the four adapters will cost, against the deployer's balance.
    const token = MAINNET ? ANT_MAINNET : state.token;
    if (token) {
      const REPORTER = keccak256(stringToHex('REPORTER'));
      const gasPrice = await pc.getGasPrice(); let gas = 0n;
      for (let i = 0; i < 4; i += 1) gas += await pc.estimateGas({ account: account.address, data: (await import('viem')).encodeDeployData({ abi: DelegatedArtifact.abi, bytecode: DelegatedArtifact.bytecode.object, args: [c.hybridAuth, REPORTER, keccak256(stringToHex(`plan${i}`)), i === 0 ? `0x${'0'.repeat(64)}` : keccak256(stringToHex(`feed${i}`)), i, i === 0, token, 300, 2500] }) });
      const bal = await pc.getBalance({ address: account.address });
      console.log(JSON.stringify({ token, adaptersGas: String(gas), gasPriceWei: String(gasPrice), adaptersCostEth: Number(gas * gasPrice) / 1e18, deployerEth: Number(bal) / 1e18, note: 'governance queue, execute, activate and the calendar add a few hundred thousand gas each' }, null, 2));
    }
  }
  process.exit(0);
}

// 1. Fixtures: test ANT token, fixture feed, four adapters.
if (!state.token && MODE === 'delegated') {
  // A test token and four delegated-attestation adapters: no feed exists, which is the situation ANT is in on mainnet.
  state.token = MAINNET ? ANT_MAINNET : await deploy('tANT token', TokenArtifact, ['Test Anthropic Class A, delegated source (BELL test)', 'tANTd', 18, account.address, parseUnits('100', 18)]);
  const tokenCode = await codeOf(state.token); state.tokenCodeHash = keccak256(tokenCode);
  const authCode = await codeOf(c.hybridAuth); const authHash = keccak256(authCode);
  const tokenId = canonicalTokenId(BigInt(CHAIN_ID), state.token);
  const ZERO = `0x${'0'.repeat(64)}`;
  const wireHash = (w) => keccak256(encodeAbiParameters(parseAbiParameters('(uint8 kind,uint8 phaseScope,address endpoint,bytes32 feedId,uint16 schema,uint8 decimals,uint8 priceBasis,uint32 heartbeatSec,bytes32 expectedCodeHash,address expectedImplementation,bytes32 canonicalTokenId) wire'), [w]));
  const wire = (kind, scope, schema, basis) => ({ kind, phaseScope: scope, endpoint: c.hybridAuth, feedId: scope === 0 ? ZERO : keccak256(encodeAbiParameters(parseAbiParameters('string label,address token,uint8 scope'), ['BELL:DELEGATED:SESSION', state.token, scope])), schema, decimals: 18, priceBasis: basis, heartbeatSec: 120, expectedCodeHash: authHash, expectedImplementation: c.hybridAuth, canonicalTokenId: tokenId });
  state.wires = [wire(1, 0, 0, 2), wire(3, 1, 12, 1), wire(3, 2, 12, 1), wire(3, 3, 12, 1)];
  const REPORTER = keccak256(stringToHex('REPORTER'));
  state.adapters = {}; state.delegatedBands = { maxStepBps: 300, maxGapBps: 2500 };
  const names = ['tokenPriceAdapter', 'regularAdapter', 'extendedAdapter', 'overnightAdapter'];
  for (let i = 0; i < 4; i += 1) {
    const w = state.wires[i];
    state.adapters[names[i]] = await deploy(names[i], DelegatedArtifact, [c.hybridAuth, REPORTER, wireHash(w), w.feedId, w.phaseScope, i === 0, state.token, 300, 2500]);
  }
  state.feed = null; save();
}
if (!state.token) {
  state.token = await deploy('tANT token', TokenArtifact, ['Test Anthropic Class A (BELL test)', 'tANT', 18, account.address, parseUnits('100', 18)]);
  state.feed = await deploy('ANT fixture feed', FeedArtifact, [8, 'ANT / USD (BELL test fixture)', BigInt(env.ANT_FIXTURE_PRICE_E8 ?? '30000000000')]);
  const feedCode = await codeOf(state.feed); const tokenCode = await codeOf(state.token);
  state.proxyCodeHash = keccak256(feedCode); state.tokenCodeHash = keccak256(tokenCode); state.implementation = state.feed;
  const plan = buildChainlinkSessionPlan({ chainId: CHAIN_ID, token: state.token, feed: state.feed, proxyCodeHash: state.proxyCodeHash, implementation: state.feed, implementationCodeHash: state.proxyCodeHash, decimals: 8 });
  const tokenId = canonicalTokenId(BigInt(CHAIN_ID), state.token);
  state.adapters = {};
  state.adapters.tokenPriceAdapter = await deploy('direct adapter', AggregatorArtifact, [state.feed, state.proxyCodeHash, state.feed, state.proxyCodeHash, 8, 86400, 2, 1, 0, tokenId]);
  for (const [scope, key] of [[1, 'regularAdapter'], [2, 'extendedAdapter'], [3, 'overnightAdapter']]) {
    state.adapters[key] = await deploy(key, SessionArtifact, [state.feed, state.proxyCodeHash, state.feed, state.proxyCodeHash, state.token, state.tokenCodeHash, 8, scope, tokenId]);
  }
  state.wires = [plan.directWire, plan.sessions[1].wire, plan.sessions[2].wire, plan.sessions[3].wire];
  save();
}

// 2. The descriptor, built the way the deploy script builds the genesis ones.
const WIRE = '(uint8 kind,uint8 phaseScope,address endpoint,bytes32 feedId,uint16 schema,uint8 decimals,uint8 priceBasis,uint32 heartbeatSec,bytes32 expectedCodeHash,address expectedImplementation,bytes32 canonicalTokenId)';
const sourceConfig = encodeAbiParameters(parseAbiParameters(`${WIRE}[] wires`), [state.wires]);
const sourceIdentity = keccak256(encodeAbiParameters(parseAbiParameters('string label,address token,bytes32 wiresHash'), [MODE === 'delegated' ? 'BELL:DELEGATED:SESSION_GENESIS_V1' : 'BELL:CHAINLINK:ROBINHOOD:SESSION_GENESIS_V1', state.token, keccak256(sourceConfig)]));
const descriptor = {
  id: `0x${'0'.repeat(64)}`, token: state.token, isStock: true, decimals: 18, capabilityMask: 30,
  tokenPriceAdapter: state.adapters.tokenPriceAdapter, regularAdapter: state.adapters.regularAdapter, extendedAdapter: state.adapters.extendedAdapter, overnightAdapter: state.adapters.overnightAdapter,
  secondaryAdapter: '0x0000000000000000000000000000000000000000', expectedCodeHash: state.tokenCodeHash, implementationFingerprint: sourceIdentity,
  evidenceHash: keccak256(encodeAbiParameters(parseAbiParameters('string label,bytes32 identity'), ['BELL:CHAINLINK:SOURCE_EVIDENCE_V1', sourceIdentity])),
};
const callData = encodeFunctionData({ abi: RegistryArtifact.abi, functionName: 'queueAsset', args: [descriptor, sourceConfig] });
const payloadHash = keccak256(encodeAbiParameters(parseAbiParameters('address target, bytes32 callDataHash'), [c.assetRegistry, keccak256(callData)]));

// 3. Hybrid-signed governance call: queueGovernanceCall, then executeGovernanceCall, which makes SafetyControllerV2 call queueAsset.
const SAFETY = parseAbi(['function queueGovernanceCall(address target,bytes callData,uint256 deadline,bytes ecdsaSignature,bytes pqSignature) returns (bytes32 operationId)', 'function executeGovernanceCall(bytes32 operationId) returns (bytes returnData)', 'function hybridAuth() view returns (address)', 'event GovernanceCallQueued(bytes32 indexed operationId,address indexed target,bytes32 payloadHash,uint64 eta)']);
const AUTH = parseAbi(['function registry() view returns (address)', 'function nonce(bytes32 role) view returns (uint256)', 'function actionDigest(bytes32 role,address target,bytes32 action,bytes32 payloadHash,uint256 actionNonce,uint32 keyVersion,uint256 deadline) view returns (bytes32)']);
const KEYS = parseAbi(['function roleKey(bytes32 role) view returns ((address ecdsaSigner,bytes32 publicKeyCommitment,uint32 maxStatefulSignatures,uint32 nextStatefulLeaf,uint32 keyVersion,bool installed))']);
const pqSign = (cmd, digest, leaf) => {
  const r = spawnSync(process.execPath, ['contracts/pq/signer/signer.mjs', cmd, 'governance', digest], { encoding: 'utf8', env: { ...process.env, BELL_PQ_KEY_PROFILE: MAINNET ? 'robinhood-4663' : 'robinhood-46630' } });
  if (r.status !== 0) throw new Error(`pq ${cmd} failed: ${r.stderr.trim()}`);
  const out = JSON.parse(r.stdout);
  if (Number(out.leafIndex) !== Number(leaf)) throw new Error(`local signer at leaf ${out.leafIndex}, chain expects ${leaf}`);
  return out.signature;
};
if (!state.governanceOperation) {
  const auth = await pc.readContract({ address: c.safetyController, abi: SAFETY, functionName: 'hybridAuth' });
  const registry = await pc.readContract({ address: auth, abi: AUTH, functionName: 'registry' });
  const [nonce, key] = await Promise.all([pc.readContract({ address: auth, abi: AUTH, functionName: 'nonce', args: [GOVERNANCE_ROLE] }), pc.readContract({ address: registry, abi: KEYS, functionName: 'roleKey', args: [GOVERNANCE_ROLE] })]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const digest = await pc.readContract({ address: auth, abi: AUTH, functionName: 'actionDigest', args: [GOVERNANCE_ROLE, c.safetyController, QUEUE_GOVERNANCE_CALL_ACTION, payloadHash, nonce, key.keyVersion, deadline] });
  const ecdsa = await account.sign({ hash: digest });
  const preview = pqSign('preview', digest, key.nextStatefulLeaf);
  await pc.simulateContract({ address: c.safetyController, abi: SAFETY, functionName: 'queueGovernanceCall', args: [c.assetRegistry, callData, deadline, ecdsa, preview], account });
  const sig = pqSign('sign', digest, key.nextStatefulLeaf);
  const hash = await wc.writeContract({ address: c.safetyController, abi: SAFETY, functionName: 'queueGovernanceCall', args: [c.assetRegistry, callData, deadline, ecdsa, sig], gas: 4_000_000n });
  const r = await wait(hash, 'queueGovernanceCall');
  const ev = parseEventLogs({ abi: SAFETY, logs: r.logs, eventName: 'GovernanceCallQueued' })[0];
  state.governanceOperation = ev.args.operationId; state.txs.queueGovernanceCall = hash; state.pqLeafUsed = key.nextStatefulLeaf; save();
  console.log('queued governance call', state.governanceOperation, 'PQ leaf', key.nextStatefulLeaf);
}
if (!state.txs.executeGovernanceCall) {
  await new Promise((r) => setTimeout(r, 3000));
  const sim = await pc.simulateContract({ address: c.safetyController, abi: SAFETY, functionName: 'executeGovernanceCall', args: [state.governanceOperation], account });
  const hash = await wc.writeContract({ ...sim.request, gas: 4_000_000n });
  await wait(hash, 'executeGovernanceCall'); state.txs.executeGovernanceCall = hash; save();
  console.log('executed governance call', hash);
}
// 4. The registry now holds a pending asset operation. Find it in the AssetQueued event and activate it.
const REG = parseAbi(['function activateAsset(bytes32 operationId) returns (bytes32)', 'function descriptorIdForToken(address token) view returns (bytes32)', 'event AssetQueued(bytes32 indexed operationId, bytes32 indexed descriptorId, uint64 eta)']);
if (!state.assetOperation) {
  // The execute transaction made the registry emit AssetQueued, so the operation id is in that receipt (a log range query is capped on this RPC).
  const receipt = await pc.getTransactionReceipt({ hash: state.txs.executeGovernanceCall });
  const hit = parseEventLogs({ abi: REG, logs: receipt.logs, eventName: 'AssetQueued' })[0];
  state.assetOperation = hit.args.operationId; state.descriptorId = hit.args.descriptorId; save();
}
if (!state.txs.activateAsset) {
  for (let i = 0; i < 20; i += 1) {
    try { const sim = await pc.simulateContract({ address: c.assetRegistry, abi: REG, functionName: 'activateAsset', args: [state.assetOperation], account }); const hash = await wc.writeContract({ ...sim.request, gas: 3_000_000n }); await wait(hash, 'activateAsset'); state.txs.activateAsset = hash; break; }
    catch (e) { console.log('activate not ready:', String(e.shortMessage ?? e).slice(0, 100)); await new Promise((r) => setTimeout(r, 5000)); }
  }
  save();
}
state.admittedDescriptorId = await pc.readContract({ address: c.assetRegistry, abi: REG, functionName: 'descriptorIdForToken', args: [state.token] });
save();
console.log('ANT admitted, descriptor', state.admittedDescriptorId);
