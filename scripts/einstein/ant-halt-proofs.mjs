#!/usr/bin/env node
/**
 * Einstein Hooks v3 halt proofs on the live mainnet ANT/USDG pool. The REPORTER actions (halt, renew, resume) are hybrid-signed by the
 * `ant-halt-action` GitHub workflow, because the REPORTER post-quantum signer state lives there; everything here needs no post-quantum key.
 *
 *   v3      a halt with ECDSA only, sent with a fixed gas limit so the revert lands on chain
 *   swap    a small swap through the router with the price update inside, the Swap event fee is read (V1 during a halt, V4 after it lapsed)
 *   exit    removes part of the seed position through the PositionManager (V6), which never calls the hook
 *   v2      a swap sent inside the reopening auction with a fixed gas limit: it must revert with AuctionActive
 *   state   prints the registry phase, the hook mode and the auction stage
 *
 *   node scripts/einstein/ant-halt-proofs.mjs v3|swap|exit|v2|state [--usdg 0.02] [--bps 100] [--label V1] --i-authorize-spend
 *
 * Results are appended to evidence/einstein/ant-mainnet-halt-proofs.json. The keeper calls (refreshState, armResume, settle) are
 * scripts/einstein/halt-keeper.mjs with --network mainnet.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, parseEventLogs, decodeAbiParameters, decodeErrorResult, encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildAntUpdate } from '../../workers/keeper-b/src/ant-update.mjs';

const cmd = process.argv[2];
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
if (!['state'].includes(cmd) && !process.argv.includes('--i-authorize-spend')) throw new Error('this sends mainnet transactions: add --i-authorize-spend');
const env = {}; for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const acct = (n) => privateKeyToAccount(env[n].startsWith('0x') ? env[n] : `0x${env[n]}`);
const pool = JSON.parse(readFileSync(arg('pool', 'evidence/einstein/ant-pool-1795488954977.json'), 'utf8'));
const dep = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const haltStack = JSON.parse(readFileSync('evidence/deploy/halt-stack-4663.json', 'utf8'));
const ant = JSON.parse(readFileSync('evidence/deploy/mainnet-4663-ant.json', 'utf8'));
const manifest = JSON.parse(readFileSync('packages/protocol/generated/abi-manifest.json', 'utf8'));
const wr = readFileSync('workers/keeper-b/wrangler.jsonc', 'utf8');
const antCfg = JSON.parse(JSON.parse(`"${wr.match(/"BELL_ANT_CONFIG": "((?:[^"\\]|\\.)*)"/)[1]}"`));
const rpc = env.RH_MAINNET_RPC_PRIMARY;
const pc = createPublicClient({ transport: http(rpc) });
const lp = acct('LP_TEST_PRIVATE_KEY');
const wc = createWalletClient({ account: lp, transport: http(rpc) });
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const ASSET = ant.admittedDescriptorId;
const GAS = { maxFeePerGas: 30_000_000n, maxPriorityFeePerGas: 1_000_000n };

const ERC20 = parseAbi(['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const HOOK = parseAbi([
  'function config() view returns ((address token0,address token1,bytes32 asset0,bytes32 asset1,address poolManager,address positionManager,address factory,address assetRegistry,address calendarRegistry,address safetyController,address treasuryAdapter,uint8 poolClass,uint8 liquidityMode,uint8 referenceMode,int24 tickSpacing,uint128[2] tradeCap,uint128[2] windowCap,uint128[2] closureCap,bytes32 policyId,address referenceAdapter0,address referenceAdapter1))',
  'function configHash() view returns (bytes32)', 'function seedPositionId() view returns (uint256)',
  'function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
]);
const SWAP = parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const REG = parseAbi(['function phase(bytes32) view returns (uint8)', 'function haltedUntil(bytes32) view returns (uint64)', 'function current(bytes32) view returns ((uint64 haltId,uint64 startTs,uint64 recordedAt,uint64 expiresAt,uint64 resumedAt,uint64 resumeTs,bytes32 reason,bool active))',
  'function halt(bytes32 assetId,uint64 haltId,uint64 startTs,bytes32 reason,uint256 deadline,bytes ecdsaSignature,bytes pqSignature)', 'function lastHaltId(bytes32) view returns (uint64)']);
const HYBRID = parseAbi(['function nonce(bytes32 role) view returns (uint256)', 'function registry() view returns (address)', 'function actionDigest(bytes32 role,address target,bytes32 action,bytes32 payloadHash,uint256 actionNonce,uint32 keyVersion,uint256 deadline) view returns (bytes32)']);
const KEYS = parseAbi(['function roleKey(bytes32 role) view returns ((address ecdsaSigner,bytes32 publicKeyCommitment,uint32 maxStatefulSignatures,uint32 nextStatefulLeaf,uint32 keyVersion,bool installed))']);
const AUCTION_REG = parseAbi(['function auctionFor(bytes32) view returns (address)']);
const AUCTION = parseAbi(['function currentStage() view returns (uint8)', 'function blocksSwaps() view returns (bool)']);
const POSM = parseAbi(['function getPositionLiquidity(uint256) view returns (uint128)', 'function ownerOf(uint256) view returns (address)', 'function modifyLiquidities(bytes unlockData, uint256 deadline) payable']);
const MODE = ['HALTED', 'ACTIVE', 'CLOSED', 'RECOVERING', 'SETUP'];
const PHASE = ['NORMAL', 'HALTED', 'RESUME_AUCTION'];
const STAGE = ['IDLE', 'ARMED', 'OPEN', 'LOCKED', 'SETTLED', 'REFUNDED'];

const OUT = 'evidence/einstein/ant-mainnet-halt-proofs.json';
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { chainId: 4663, pool: pool.poolId, hook: pool.hook, haltRegistry: haltStack.contracts.haltRegistry, asset: ASSET, checks: {} };
const save = () => { out.recordedAt = new Date().toISOString(); writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`); };

const state = async () => {
  const [phase, until, pol] = await Promise.all([
    pc.readContract({ address: haltStack.contracts.haltRegistry, abi: REG, functionName: 'phase', args: [ASSET] }),
    pc.readContract({ address: haltStack.contracts.haltRegistry, abi: REG, functionName: 'haltedUntil', args: [ASSET] }),
    pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'getPolicy' }),
  ]);
  const auction = await pc.readContract({ address: haltStack.contracts.auctionRegistry, abi: AUCTION_REG, functionName: 'auctionFor', args: [pool.poolId] });
  const [stage, blocks] = await Promise.all([pc.readContract({ address: auction, abi: AUCTION, functionName: 'currentStage' }), pc.readContract({ address: auction, abi: AUCTION, functionName: 'blocksSwaps' })]);
  return { registry: PHASE[phase], haltedUntil: Number(until), hookMode: MODE[pol.mode], canSwap: pol.canSwap, lpFeeUnits: pol.lpFeeUnits, reasonBits: String(pol.reasonBits), auction: STAGE[stage], auctionBlocksSwaps: blocks };
};

async function request(usdg) {
  const bundle = await buildAntUpdate({ cfg: antCfg, delegateKey: env.ANT_DELEGATE_PRIVATE_KEY, client: pc });
  const update = {
    assetId: bundle.assetId,
    directSample: Object.fromEntries(Object.entries(bundle.directSample).map(([k, v]) => ['price18', 'observedAt', 'inputAt', 'validFrom', 'expiresAt', 'validUntil', 'phase'].includes(k) ? [k, BigInt(v)] : [k, v])),
    directSignature: bundle.directSignature, reports: bundle.reports, closeBoundaryHash: bundle.closeBoundaryHash,
  };
  const config = await pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'config' });
  const zeroForOne = config.token0.toLowerCase() === USDG.toLowerCase();
  const amount = parseUnits(String(usdg), 6);
  const nonce = await pc.readContract({ address: dep.router, abi: manifest.interfaces.IBellRouter, functionName: 'nonces', args: [lp.address] });
  const allowance = await pc.readContract({ address: USDG, abi: ERC20, functionName: 'allowance', args: [lp.address, dep.router] });
  if (allowance < amount) { const a = await wc.writeContract({ address: USDG, abi: ERC20, functionName: 'approve', args: [dep.router, amount], ...GAS }); await pc.waitForTransactionReceipt({ hash: a }); }
  return { amount, req: {
    hook: pool.hook, zeroForOne, exactInput: true, amountSpecified: amount, limitAmount: 1n,
    sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n,
    recipient: lp.address, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 120),
    expectedConfigHash: await pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'configHash' }), wrapInput: false, unwrapOutput: false, unwrapRefund: false, oracleUpdates: [update],
  } };
}
const feeOf = (rc) => parseEventLogs({ abi: SWAP, logs: rc.logs }).find((l) => l.args.id.toLowerCase() === pool.poolId.toLowerCase())?.args.fee ?? null;
async function revertName(hash) {
  const tx = await pc.getTransaction({ hash }); let data = null;
  try { await pc.call({ account: tx.from, to: tx.to, data: tx.input, blockNumber: tx.blockNumber - 1n }); } catch (e) { let c = e; while (c && !data) { data = typeof c.data === 'string' && c.data.startsWith('0x') ? c.data : null; c = c.cause; } }
  if (!data) return null;
  if (data.startsWith('0x90bfb865')) { const [, , reason] = decodeAbiParameters([{ type: 'address' }, { type: 'bytes4' }, { type: 'bytes' }, { type: 'bytes' }], `0x${data.slice(10)}`); return `${reason.slice(0, 10)} (wrapped by the PoolManager)${reason.startsWith('0xecb1f63f') ? ' = TradeCapExceeded' : ''}`; }
  return data.slice(0, 10);
}

if (cmd === 'state') {
  console.log(JSON.stringify(await state(), (k, v) => (typeof v === 'bigint' ? String(v) : v), 2));
} else if (cmd === 'v3') {
  // A halt with the REPORTER ECDSA signature and no post-quantum signature: the registry must refuse it.
  const reporter = acct('YAHOO_REPORTER_PRIVATE_KEY');
  const REPORTER = keccak256(stringToHex('REPORTER'));
  const auth = (await pc.readContract({ address: haltStack.contracts.haltRegistry, abi: parseAbi(['function hybridAuth() view returns (address)']), functionName: 'hybridAuth' }));
  const registry = await pc.readContract({ address: auth, abi: HYBRID, functionName: 'registry' });
  const [nonce, key, block] = await Promise.all([pc.readContract({ address: auth, abi: HYBRID, functionName: 'nonce', args: [REPORTER] }), pc.readContract({ address: registry, abi: KEYS, functionName: 'roleKey', args: [REPORTER] }), pc.getBlock()]);
  const haltId = (await pc.readContract({ address: haltStack.contracts.haltRegistry, abi: REG, functionName: 'lastHaltId', args: [ASSET] })) + 1n;
  const startTs = block.timestamp - 30n; const reason = keccak256(stringToHex('LULD')); const deadline = block.timestamp + 3600n;
  const payloadHash = keccak256(encodeAbiParameters(parseAbiParameters('address registry,bytes32 asset,uint64 haltId,uint64 startTs,bytes32 reason'), [haltStack.contracts.haltRegistry, ASSET, haltId, startTs, reason]));
  const digest = await pc.readContract({ address: auth, abi: HYBRID, functionName: 'actionDigest', args: [REPORTER, haltStack.contracts.haltRegistry, keccak256(stringToHex('BELL_HALT_V1')), payloadHash, nonce, key.keyVersion, deadline] });
  const ecdsa = await reporter.sign({ hash: digest });
  const hash = await wc.writeContract({ address: haltStack.contracts.haltRegistry, abi: REG, functionName: 'halt', args: [ASSET, haltId, startTs, reason, deadline, ecdsa, '0x'], gas: 1_500_000n, ...GAS });
  const rc = await pc.waitForTransactionReceipt({ hash });
  const st = await state();
  out.checks.V3 = { verdict: rc.status === 'reverted' && st.registry === 'NORMAL' ? 'PASS' : 'FAIL', tx: hash, block: Number(rc.blockNumber), error: await revertName(hash), note: 'a halt with the REPORTER ECDSA signature and an empty post-quantum signature reverted; the registry stayed NORMAL' };
  save(); console.log('V3', out.checks.V3.verdict, hash, out.checks.V3.error);
} else if (cmd === 'swap') {
  const { amount, req } = await request(arg('usdg', '0.02'));
  const before = await state();
  const sim = await pc.simulateContract({ address: dep.router, abi: manifest.interfaces.IBellRouter, functionName: 'swap', args: [req], account: lp });
  const hash = await wc.writeContract({ ...sim.request, ...GAS });
  const rc = await pc.waitForTransactionReceipt({ hash });
  const fee = feeOf(rc); const label = arg('label', 'swap');
  out.checks[label] = { ...(out.checks[label] ?? {}), swapTx: hash, block: Number(rc.blockNumber), feePips: fee, amountUsdg: Number(amount) / 1e6, stateBefore: before, status: rc.status };
  save(); console.log(label, rc.status, 'fee', fee, hash, JSON.stringify(before));
} else if (cmd === 'v2') {
  const { req } = await request(arg('usdg', '0.02'));
  const hash = await wc.writeContract({ address: dep.router, abi: manifest.interfaces.IBellRouter, functionName: 'swap', args: [req], gas: 1_500_000n, ...GAS });
  const rc = await pc.waitForTransactionReceipt({ hash });
  const st = await state();
  const name = await revertName(hash);
  out.checks.V2 = { ...(out.checks.V2 ?? {}), swapTx: hash, block: Number(rc.blockNumber), status: rc.status, error: name, stateAtRevert: st, verdict: rc.status === 'reverted' ? 'REVIEW' : 'FAIL' };
  save(); console.log('V2 swap', rc.status, name, hash, JSON.stringify(st));
} else if (cmd === 'exit') {
  const bps = BigInt(arg('bps', '100'));
  const tokenId = await pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'seedPositionId' });
  const [liq, owner] = await Promise.all([pc.readContract({ address: dep.positionManager, abi: POSM, functionName: 'getPositionLiquidity', args: [tokenId] }), pc.readContract({ address: dep.positionManager, abi: POSM, functionName: 'ownerOf', args: [tokenId] })]);
  if (owner.toLowerCase() !== lp.address.toLowerCase()) throw new Error(`position ${tokenId} is owned by ${owner}`);
  const remove = (liq * bps) / 10_000n;
  const config = await pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'config' });
  const params = [
    encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }], [tokenId, remove, 0n, 0n, '0x']),
    encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [config.token0, config.token1, lp.address]),
  ];
  const unlockData = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], ['0x0111', params]);
  const before = await state();
  const sim = await pc.simulateContract({ address: dep.positionManager, abi: POSM, functionName: 'modifyLiquidities', args: [unlockData, BigInt(Math.floor(Date.now() / 1000) + 600)], account: lp });
  const hash = await wc.writeContract({ ...sim.request, ...GAS });
  const rc = await pc.waitForTransactionReceipt({ hash });
  const touched = rc.logs.some((l) => l.address.toLowerCase() === pool.hook.toLowerCase());
  const after = await pc.readContract({ address: dep.positionManager, abi: POSM, functionName: 'getPositionLiquidity', args: [tokenId], blockNumber: rc.blockNumber });
  out.checks.V6 = { verdict: rc.status === 'success' && !touched && before.registry === 'HALTED' ? 'PASS' : 'FAIL', tx: hash, block: Number(rc.blockNumber), removedBps: Number(bps), liquidityBefore: String(liq), liquidityAfter: String(after), hookEmittedLogs: touched, stateBefore: before, note: 'liquidity removed through the PositionManager while the registry was HALTED; the hook emitted no log and no post-quantum signature was needed' };
  save(); console.log('V6', out.checks.V6.verdict, hash);
} else throw new Error('usage: ant-halt-proofs.mjs v3|swap|exit|v2|state');
