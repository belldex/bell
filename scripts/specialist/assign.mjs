#!/usr/bin/env node
/**
 * Assigns a bonded Specialist to a stock on a SpecialistRegistry. The call is hybrid-signed: ECDSA by the GOVERNANCE role's signer (the deployer
 * wallet) and SHRINCS by the GOVERNANCE signer state, one leaf per assignment. The signer state is encrypted and lives on the pq-state branch,
 * so this runs in the specialist-assign workflow, the same way the calendar renewal signs.
 *
 *   node scripts/specialist/assign.mjs --label test --specialist 0x... [--stock NVDA] [--broadcast]
 *
 * Default is a simulation: both signatures are built from a preview and the call is simulated, nothing is sent.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseAbiParameters, parseAbi, stringToHex, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const broadcast = process.argv.includes('--broadcast');
const env = {};
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); } } catch { /* CI */ }
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
const deploy = JSON.parse(readFileSync(`evidence/deploy/specialist-4663-${arg('label', 'test')}.json`, 'utf8'));
const REGISTRY = getAddress(deploy.contract);
const AUTH = deploy.constructor.hybridAuth;
const specialist = getAddress(arg('specialist'));
const stock = keccak256(stringToHex(arg('stock', 'NVDA')));
const rpc = env.RH_MAINNET_RPC_PRIMARY || env.RH_MAINNET_RPC_SECONDARY;
const pc = createPublicClient({ transport: http(rpc) });
const key = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY;
const governance = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`); // the GOVERNANCE role's ECDSA signer, also pays gas
const wc = createWalletClient({ account: governance, transport: http(rpc) });
const ROLE = keccak256(stringToHex('GOVERNANCE'));
const ACTION = keccak256(stringToHex('BELL_SPECIALIST_ASSIGN_V1'));
const REG = parseAbi([
  'function assign(bytes32 stock,address specialist,uint256 deadline,bytes ecdsaSignature,bytes pqSignature) returns (uint32)',
  'function bonds(address) view returns (uint128 bell,uint128 usdg,bytes32 stock,uint64 unbondAt,bool removed)',
  'function specialistOf(bytes32) view returns (address)',
]);
const HYBRID = parseAbi(['function nonce(bytes32 role) view returns (uint256)', 'function registry() view returns (address)', 'function actionDigest(bytes32 role,address target,bytes32 action,bytes32 payloadHash,uint256 actionNonce,uint32 keyVersion,uint256 deadline) view returns (bytes32)']);
const KEYS = parseAbi(['function roleKey(bytes32 role) view returns ((address ecdsaSigner,bytes32 publicKeyCommitment,uint32 maxStatefulSignatures,uint32 nextStatefulLeaf,uint32 keyVersion,bool installed))']);

const pq = (cmd, digest, leaf) => {
  const r = spawnSync(process.execPath, ['contracts/pq/signer/signer.mjs', cmd, 'governance', digest], { encoding: 'utf8', env: { ...process.env, BELL_PQ_KEY_PROFILE: 'robinhood-4663' } });
  if (r.status !== 0) throw new Error(`pq ${cmd} failed: ${r.stderr.trim()}`);
  const out = JSON.parse(r.stdout);
  if (Number(out.leafIndex) !== Number(leaf)) throw new Error(`local governance signer at leaf ${out.leafIndex}, chain expects ${leaf}`);
  return out.signature;
};

if ((await pc.getChainId()) !== 4663) throw new Error('RPC is not Robinhood mainnet');
const [bond, holder] = await Promise.all([pc.readContract({ address: REGISTRY, abi: REG, functionName: 'bonds', args: [specialist] }), pc.readContract({ address: REGISTRY, abi: REG, functionName: 'specialistOf', args: [stock] })]);
if (bond[0] === 0n) throw new Error('that address has no bond yet');
if (holder !== '0x0000000000000000000000000000000000000000') throw new Error(`the stock already has a Specialist: ${holder}`);
const payloadHash = keccak256(encodeAbiParameters(parseAbiParameters('address registry,bytes32 stock,address specialist,uint128 bell,uint128 usdg'), [REGISTRY, stock, specialist, bond[0], bond[1]]));

const registry = await pc.readContract({ address: AUTH, abi: HYBRID, functionName: 'registry' });
const [nonce, roleKey, block] = await Promise.all([pc.readContract({ address: AUTH, abi: HYBRID, functionName: 'nonce', args: [ROLE] }), pc.readContract({ address: registry, abi: KEYS, functionName: 'roleKey', args: [ROLE] }), pc.getBlock()]);
if (roleKey.ecdsaSigner.toLowerCase() !== governance.address.toLowerCase()) throw new Error(`the deployer wallet ${governance.address} is not the GOVERNANCE signer ${roleKey.ecdsaSigner}`);
const deadline = block.timestamp + 3600n;
const digest = await pc.readContract({ address: AUTH, abi: HYBRID, functionName: 'actionDigest', args: [ROLE, REGISTRY, ACTION, payloadHash, nonce, roleKey.keyVersion, deadline] });
const ecdsa = await governance.sign({ hash: digest });
const preview = pq('preview', digest, roleKey.nextStatefulLeaf);
await pc.simulateContract({ address: REGISTRY, abi: REG, functionName: 'assign', args: [stock, specialist, deadline, ecdsa, preview], account: governance });
console.log(`simulation passed: GOVERNANCE leaf ${roleKey.nextStatefulLeaf}, nonce ${nonce}, specialist ${specialist}`);
if (!broadcast) { console.log('dry run: nothing sent'); process.exit(0); }
const signed = pq('sign', digest, roleKey.nextStatefulLeaf);
const tx = await wc.writeContract({ address: REGISTRY, abi: REG, functionName: 'assign', args: [stock, specialist, deadline, ecdsa, signed], gas: 3_000_000n });
const r = await pc.waitForTransactionReceipt({ hash: tx });
if (r.status !== 'success') throw new Error(`assign reverted: ${tx}`);
console.log(JSON.stringify({ assigned: specialist, tx, block: Number(r.blockNumber), governanceLeaf: Number(roleKey.nextStatefulLeaf) }));
