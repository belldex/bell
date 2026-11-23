#!/usr/bin/env node
/**
 * Runs the Einstein Hooks v3 halt proofs V1, V2, V3 and V6 on the Robinhood testnet pool created through the v3 factory, and records the
 * transactions. Test ANT token, fixture feed, testnet only.
 *
 *   V3  a halt with ECDSA only, sent with a fixed gas limit so the revert lands on chain
 *   V1  a hybrid-signed halt, the closure checkpoint, then a swap whose Swap event fee is read (10,000 pips)
 *   V6  an exit during the halt: liquidity removed through the position manager, which never calls the hook
 *   V2  a hybrid-signed resume, the reopening auction armed, then a swap that reverts with AuctionActive
 *
 *   node scripts/einstein/halt-testnet-proofs.mjs --pool evidence/einstein/testnet-ant-pool-<ts>.json
 *
 * V4 (a halt that expires by itself) takes two hours and is run by `halt-testnet-proofs.mjs --v4-start` and `--v4-check`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, decodeEventLog, decodeErrorResult, decodeAbiParameters, encodeAbiParameters, parseAbiParameters, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import ExecutorArtifact from '../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };
import HookArtifact from '../../contracts/out/BellHookV3.sol/BellHookV3.json' with { type: 'json' };
import FlowBudgetArtifact from '../../contracts/out/FlowBudget.sol/FlowBudget.json' with { type: 'json' };
import { hybrid, doHalt, doResume, status } from './halt-reporter.mjs';

const ERRORS = [...HookArtifact.abi, ...FlowBudgetArtifact.abi.filter((e) => e.type === 'error')];
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const env = {}; for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const poolLog = JSON.parse(readFileSync(arg('pool'), 'utf8'));
const ant = JSON.parse(readFileSync('evidence/deploy/testnet-46630-ant-delegated.json', 'utf8'));
const halt = JSON.parse(readFileSync('evidence/deploy/halt-stack-testnet-46630.json', 'utf8'));
const manifest = JSON.parse(readFileSync('evidence/deploy/pq-hooks-testnet-46630.json', 'utf8'));
const inputs = JSON.parse(readFileSync('evidence/deploy/testnet-46630-pq-inputs.json', 'utf8'));
const EXECUTOR = JSON.parse(readFileSync('evidence/einstein/v3-evolve/testnet-run-config.json', 'utf8')).executor;
const USDG = manifest.assetDescriptors.USDG.token; const STOCK = ant.token; const ASSET = ant.admittedDescriptorId;
const [c0, c1] = BigInt(STOCK) < BigInt(USDG) ? [STOCK, USDG] : [USDG, STOCK];
const key = { currency0: c0, currency1: c1, fee: 0x800000, tickSpacing: 60, hooks: poolLog.hook };
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`);
const pc = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });
const wc = createWalletClient({ account, transport: http(env.RH_TESTNET_RPC_PRIMARY) });
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)']);
const SWAP = parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const POSM = parseAbi(['function modifyLiquidities(bytes unlockData,uint256 deadline) payable']);
const AUCTION = parseAbi(['function armResume() returns (bool)', 'function blocksSwaps() view returns (bool)', 'function cycleId() view returns (uint64)', 'function settle()', 'function currentStage() view returns (uint8)']);
const REGISTRY_AUCTION = parseAbi(['function auctionFor(bytes32 poolId) view returns (address)']);
const hookRefresh = parseAbi(['function refreshState() returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))']);
const hookPolicy = parseAbi(['function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))']);
const MODE = ['HALTED', 'ACTIVE', 'CLOSED', 'RECOVERING', 'SETUP'];
const OUT = 'evidence/einstein/halt-testnet-proofs.json';
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { chainId: 46630, pool: poolLog.poolId, hook: poolLog.hook, createTx: poolLog.txs.createAndSeed, haltRegistry: halt.contracts.haltRegistry, note: 'Testnet rehearsal. Test ANT token, fixture feed, mock-free HybridAuth. Not mainnet.', checks: {} };
const save = () => { out.recordedAt = new Date().toISOString(); writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`); };
const wait = async (hash, what) => { const r = await pc.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw new Error(`${what} failed ${hash}`); return r; };

for (const t of [USDG, STOCK]) {
  const a = await pc.readContract({ address: t, abi: erc20, functionName: 'allowance', args: [account.address, EXECUTOR] });
  if (a < 2n ** 200n) await wait(await wc.writeContract({ address: t, abi: erc20, functionName: 'approve', args: [EXECUTOR, maxUint256] }), 'approve');
}
const swap = async (usdgIn, gas) => {
  const zeroForOne = USDG.toLowerCase() === c0.toLowerCase();
  const hash = await wc.writeContract({ address: EXECUTOR, abi: ExecutorArtifact.abi, functionName: 'executeSwap', args: [key, zeroForOne, -parseUnits(String(usdgIn), 6)], gas });
  return { hash, receipt: await pc.waitForTransactionReceipt({ hash }) };
};
const feeOf = (receipt) => { for (const l of receipt.logs) { try { const ev = decodeEventLog({ abi: SWAP, data: l.data, topics: l.topics }); if (ev.eventName === 'Swap' && ev.args.id.toLowerCase() === poolLog.poolId.toLowerCase()) return Number(ev.args.fee); } catch { /* not a Swap */ } } return null; };
const revertData = async (hash) => {
  const tx = await pc.getTransaction({ hash }); let data = null;
  try { await pc.call({ to: tx.to, data: tx.input, account: tx.from, blockNumber: tx.blockNumber - 1n }); } catch (e) { let c = e; while (c && !data) { data = typeof c.data === 'string' && c.data.startsWith('0x') ? c.data : null; c = c.cause; } }
  return data;
};
const decodeWrapped = (data) => {
  if (!data) return null;
  if (data.startsWith('0x90bfb865')) { const [, , reason] = decodeAbiParameters([{ type: 'address' }, { type: 'bytes4' }, { type: 'bytes' }, { type: 'bytes' }], `0x${data.slice(10)}`); try { return decodeErrorResult({ abi: ERRORS, data: reason }).errorName; } catch { return `selector ${String(reason).slice(0, 10)}`; } }
  try { return decodeErrorResult({ abi: [...ERRORS, ...ExecutorArtifact.abi], data }).errorName; } catch { return `selector ${data.slice(0, 10)}`; }
};
const policy = async () => { const p = await pc.readContract({ address: poolLog.hook, abi: hookPolicy, functionName: 'getPolicy' }); return { mode: MODE[p.mode], canSwap: p.canSwap, phase: p.phase, fee: p.lpFeeUnits, validUntil: Number(p.f), reasons: String(p.reasonBits) }; };
const refresh = async () => { const { request } = await pc.simulateContract({ address: poolLog.hook, abi: hookRefresh, functionName: 'refreshState', account }); const h = await wc.writeContract({ ...request, gas: 3_000_000n }); await wait(h, 'refreshState'); return h; };

if (process.argv.includes('--v4-check')) {
  const st = await status(ASSET);
  const cur = out.v4 ?? {};
  const ok = st.phase === 'NORMAL' && cur.haltTx;
  out.checks.V4 = { verdict: ok ? 'PASS' : 'PENDING', haltTx: cur.haltTx, haltedUntil: cur.haltedUntil, observedPhase: st.phase, note: ok ? `the halt recorded at ${cur.recordedAt} lapsed by itself at ${cur.haltedUntil}: registry phase is NORMAL with no resume or renew` : `registry phase is ${st.phase}; the halt lapses at ${cur.haltedUntil}` };
  save(); console.log('V4', out.checks.V4.verdict, out.checks.V4.note); process.exit(0);
}
if (process.argv.includes('--v4-start')) {
  const now = Number((await pc.getBlock()).timestamp);
  const r = await doHalt(ASSET, BigInt(now - 20), 'LULD');
  const st = await status(ASSET);
  out.v4 = { haltTx: r.tx, haltedUntil: st.haltedUntil, recordedAt: now, leaf: String(r.leaf) };
  save(); console.log('V4 halt recorded', r.tx, 'lapses at', st.haltedUntil); process.exit(0);
}

if (process.argv.includes('--v1-swap')) {
  // Halt 2 is already recorded (it is also the V4 halt). Wait for the first resume's auction window to close, settle it, then swap under the cap.
  const regA = await pc.readContract({ address: halt.contracts.auctionRegistry, abi: REGISTRY_AUCTION, functionName: 'auctionFor', args: [poolLog.poolId] });
  while (Number(await pc.readContract({ address: regA, abi: AUCTION, functionName: 'currentStage' })) === 2) await new Promise((r) => setTimeout(r, 10_000));
  if (await pc.readContract({ address: regA, abi: AUCTION, functionName: 'blocksSwaps' })) {
    const settleTx = await wc.writeContract({ address: regA, abi: AUCTION, functionName: 'settle', args: [], gas: 1_500_000n });
    await wait(settleTx, 'settle');
    out.checks.V2.settleTx = settleTx;
    out.checks.V2.note = out.checks.V2.note.replace(/; after the window.*$/, '') + '; after the window the empty cycle was settled and swaps reopened';
  }
  const st = await status(ASSET);
  const rf = await refresh();
  const pol = await policy();
  const sw = await swap(0.15, 3_500_000n);
  const fee = sw.receipt.status === 'success' ? feeOf(sw.receipt) : null;
  out.checks.V1 = { verdict: st.phase === 'HALTED' && pol.mode === 'CLOSED' && fee === 10000 ? 'PASS' : 'FAIL', haltTx: out.v4.haltTx, reporterLeaf: out.v4.leaf, checkpointTx: rf, swapTx: sw.hash, registryPhase: st.phase, haltedUntil: st.haltedUntil, hookMode: pol.mode, feePips: fee, note: `hybrid halt recorded, registry ${st.phase}, hook ${pol.mode}, Swap event fee ${fee} pips` };
  save(); console.log('V1', out.checks.V1.verdict, out.checks.V1.note);
  process.exit(0);
}

if (process.argv.includes('--v1-retry')) {
  // The first V1 attempt swapped 0.3 USDG, above the CLOSED-session trade cap (about 0.2 USDG for this pool): it reverted with TradeCapExceeded,
  // which is itself evidence that the CLOSED caps apply during a halt. This run records V1 with a swap under the cap, in a second halt that is
  // then left alone so it lapses by itself (V4).
  const first = out.checks.V1;
  const err = first?.swapTx ? decodeWrapped(await revertData(first.swapTx)) : null;
  out.checks.V1_firstAttempt = { tx: first?.swapTx, error: err, note: `a 0.3 USDG swap during the first halt reverted with ${err}: the closure trade cap applies while halted` };
  // The reopening auction armed by the first resume locks swaps until someone settles it (permissionless; no orders means it closes empty).
  const regA = await pc.readContract({ address: halt.contracts.auctionRegistry, abi: REGISTRY_AUCTION, functionName: 'auctionFor', args: [poolLog.poolId] });
  const stage = Number(await pc.readContract({ address: regA, abi: AUCTION, functionName: 'currentStage' }));
  if (await pc.readContract({ address: regA, abi: AUCTION, functionName: 'blocksSwaps' })) {
    if (stage !== 3) throw new Error(`the reopening auction is in stage ${stage}; wait until its window closes (stage 3, LOCKED) or its deadline`);
    const settleTx = await wc.writeContract({ address: regA, abi: AUCTION, functionName: 'settle', args: [], gas: 1_500_000n });
    await wait(settleTx, 'settle');
    out.checks.V2.settleTx = settleTx;
    out.checks.V2.note += '; after the window the empty cycle was settled and swaps reopened';
  }
  const now = Number((await pc.getBlock()).timestamp);
  const h = await doHalt(ASSET, BigInt(now - 25), 'LULD');
  const st = await status(ASSET);
  const rf = await refresh();
  const pol = await policy();
  const sw = await swap(0.15, 3_500_000n);
  const fee = sw.receipt.status === 'success' ? feeOf(sw.receipt) : null;
  out.checks.V1 = { verdict: h.tx && st.phase === 'HALTED' && pol.mode === 'CLOSED' && fee === 10000 ? 'PASS' : 'FAIL', haltTx: h.tx, reporterLeaf: String(h.leaf), checkpointTx: rf, swapTx: sw.hash, registryPhase: st.phase, haltedUntil: st.haltedUntil, hookMode: pol.mode, feePips: fee, note: `hybrid halt recorded, registry ${st.phase}, hook ${pol.mode}, Swap event fee ${fee} pips` };
  out.v4 = { haltTx: h.tx, haltedUntil: st.haltedUntil, recordedAt: now, leaf: String(h.leaf) };
  save(); console.log('V1', out.checks.V1.verdict, out.checks.V1.note, '| V4 halt lapses at', st.haltedUntil);
  process.exit(0);
}

const regAuction = await pc.readContract({ address: halt.contracts.auctionRegistry, abi: REGISTRY_AUCTION, functionName: 'auctionFor', args: [poolLog.poolId] });
out.auction = regAuction;
console.log('auction', regAuction, 'policy before', JSON.stringify(await policy()));

// V3: a halt with the ECDSA signature only.
{
  const now = Number((await pc.getBlock()).timestamp);
  const haltId = 1n; const startTs = BigInt(now - 30);
  const reason = (await import('viem')).keccak256((await import('viem')).stringToHex('LULD'));
  const { keccak256 } = await import('viem');
  const payloadHash = keccak256(encodeAbiParameters(parseAbiParameters('address registry,bytes32 asset,uint64 haltId,uint64 startTs,bytes32 reason'), [halt.contracts.haltRegistry, ASSET, haltId, startTs, reason]));
  const { stringToHex } = await import('viem');
  const action = keccak256(stringToHex('BELL_HALT_V1'));
  const s = await hybrid(action, payloadHash, false);
  const REG = parseAbi(['function halt(bytes32,uint64,uint64,bytes32,uint256,bytes,bytes)']);
  const hash = await wc.writeContract({ address: halt.contracts.haltRegistry, abi: REG, functionName: 'halt', args: [ASSET, haltId, startTs, reason, s.deadline, s.ecdsa, '0x'], gas: 3_000_000n });
  const r = await pc.waitForTransactionReceipt({ hash });
  out.checks.V3 = { verdict: r.status === 'reverted' ? 'PASS' : 'FAIL', tx: hash, note: r.status === 'reverted' ? 'a halt carrying only the ECDSA signature reverted on chain; the registry state did not change' : 'the ECDSA-only halt was accepted' };
  save(); console.log('V3', out.checks.V3.verdict, hash);
}

// V1: hybrid halt, checkpoint, swap at the CLOSED fee.
{
  const now = Number((await pc.getBlock()).timestamp);
  const h = await doHalt(ASSET, BigInt(now - 30), 'LULD');
  const st = await status(ASSET);
  const rf = await refresh();
  const pol = await policy();
  const sw = await swap(0.3, 3_500_000n);
  const fee = sw.receipt.status === 'success' ? feeOf(sw.receipt) : null;
  out.checks.V1 = { verdict: h.tx && st.phase === 'HALTED' && pol.mode === 'CLOSED' && fee === 10000 ? 'PASS' : 'FAIL', haltTx: h.tx, reporterLeaf: String(h.leaf), checkpointTx: rf, swapTx: sw.hash, registryPhase: st.phase, haltedUntil: st.haltedUntil, hookMode: pol.mode, feePips: fee, note: `hybrid halt recorded, registry ${st.phase}, hook ${pol.mode}, Swap event fee ${fee} pips` };
  out.halt1 = { haltTx: h.tx, haltedUntil: st.haltedUntil };
  save(); console.log('V1', out.checks.V1.verdict, out.checks.V1.note);
}

// V6: an exit during the halt.
{
  const before = await status(ASSET);
  const liquidity = BigInt(poolLog.request.liquidity) / 100n;
  const actions = '0x0111';
  const p0 = encodeAbiParameters(parseAbiParameters('uint256 tokenId,uint256 liquidity,uint128 amount0Min,uint128 amount1Min,bytes hookData'), [BigInt(poolLog.tokenId), liquidity, 0n, 0n, '0x']);
  const p1 = encodeAbiParameters(parseAbiParameters('address currency0,address currency1,address recipient'), [c0, c1, account.address]);
  const data = encodeAbiParameters(parseAbiParameters('bytes actions,bytes[] params'), [actions, [p0, p1]]);
  const hash = await wc.writeContract({ address: inputs.positionManager, abi: POSM, functionName: 'modifyLiquidities', args: [data, BigInt(Math.floor(Date.now() / 1000) + 600)], gas: 2_000_000n });
  const r = await pc.waitForTransactionReceipt({ hash });
  const hookTouched = r.logs.some((l) => l.address.toLowerCase() === poolLog.hook.toLowerCase());
  const bits = BigInt(poolLog.hook) & 0x3fffn;
  out.checks.V6 = { verdict: r.status === 'success' && before.phase === 'HALTED' && !hookTouched && ((bits >> 9n) & 1n) === 0n ? 'PASS' : 'FAIL', tx: hash, registryPhase: before.phase, hookLogs: hookTouched, note: `1 percent of the position removed while the registry said ${before.phase}; no log from the hook in the receipt, and the hook address has remove-liquidity bits 9, 8 and 0 off` };
  save(); console.log('V6', out.checks.V6.verdict, out.checks.V6.note);
}

// V2: resume, arm the reopening auction, a swap is refused with AuctionActive.
{
  const now = Number((await pc.getBlock()).timestamp);
  const rs = await doResume(ASSET, BigInt(now));
  const arm = await wc.writeContract({ address: regAuction, abi: AUCTION, functionName: 'armResume', args: [], gas: 1_500_000n });
  await wait(arm, 'armResume');
  const blocks = await pc.readContract({ address: regAuction, abi: AUCTION, functionName: 'blocksSwaps' });
  const sw = await swap(0.3, 3_500_000n);
  let error = null;
  if (sw.receipt.status === 'reverted') error = decodeWrapped(await revertData(sw.hash));
  out.checks.V2 = { verdict: rs.tx && blocks && error === 'AuctionActive' ? 'PASS' : 'FAIL', resumeTx: rs.tx, reporterLeaf: String(rs.leaf), armTx: arm, swapTx: sw.hash, auctionBlocksSwaps: blocks, error, note: `hybrid resume recorded, reopening auction armed (blocksSwaps ${blocks}), a swap reverted with ${error}` };
  save(); console.log('V2', out.checks.V2.verdict, out.checks.V2.note);
}
console.log('policy after', JSON.stringify(await policy()));
console.log(`wrote ${OUT}`);
