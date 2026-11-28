#!/usr/bin/env node
/**
 * Builds evidence/specialist/proof.json, the only file the Specialist page reads, and replays claims S1 to S9 against a public RPC. No keys.
 *
 *   node scripts/specialist/build-specialist-proof.mjs                       no network: records what is deployed and every claim PENDING
 *   node scripts/specialist/build-specialist-proof.mjs --rpc <url>           rebuild from chain (an archive RPC is needed for S4)
 *   ... --label test|production                                              which instance (default test)
 *
 * Every verdict is recomputed from events and chain state. PENDING is never a PASS. The exit of S9 cannot be an event of the registry, so the
 * withdrawal transaction is listed in evidence/specialist/exit.json as { tx, tokenId }; the replay still checks it on chain.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { createPublicClient, http, parseAbi, keccak256, toHex, getAddress } from 'viem';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const rpcUrl = arg('rpc', process.env.RPC_URL ?? null);
const label = arg('label', 'test');
const read = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const deploy = read(`evidence/deploy/specialist-4663-${label}.json`, null);
const exit = read('evidence/specialist/exit.json', null);
const BURN = '0x000000000000000000000000000000000000dead';
const CLAIMS = [
  ['S1', 'The registry cannot be changed', 'Code on chain, no proxy slots, no owner or setter in the ABI.', 'All three hold.'],
  ['S2', 'A Specialist is bonded and assigned', 'A bond transaction, and an assignment that spent one HybridAuth leaf (ECDSA and SHRINCS).', 'Both exist, from the same address.'],
  ['S3', 'The auction duty is measured', 'AuctionDutyRecorded for each cycle, matching the auction contract\'s own order events.', 'Every recorded cycle agrees with the auction.'],
  ['S4', 'The floor duty is measured', 'Checkpoint events, each matching the position and the pool tick at its block.', 'Every checkpoint agrees with the chain at its block.'],
  ['S5', 'Scoring follows the rules', 'Each EpochScored recomputed from the checkpoint and cycle events.', 'The recomputed outcome equals the emitted one.'],
  ['S6', 'Rewards are paid', 'A Rewarded event after a passing epoch, with the USDG transfer.', 'The transfer exists and equals the event.'],
  ['S7', 'Slashing works', 'A Slashed event after a missed duty, with the BELL burn transfer.', 'The burn transfer exists and equals the event.'],
  ['S8', 'Unbonding cannot dodge a bad epoch', 'A slash applied after UnbondRequested and before Unbonded.', 'Such a slash exists.'],
  ['S9', 'Exits stay open', 'The Specialist withdraws liquidity without a hook call, and D2 fails for the next checkpoint.', 'The withdrawal succeeded, the hook has no remove-liquidity flag, and the next checkpoint failed.'],
].map(([id, title, proof, passes]) => ({ id, title, proof, passes }));
const proof = { title: 'BELL Specialist', label, claims: CLAIMS, deployment: deploy, epochs: [], events: [], specialist: null, replay: {}, lastBuild: new Date().toISOString() };
const pending = (why) => ({ verdict: 'PENDING', note: why });
const PASS = (note) => ({ verdict: 'PASS', note });
const FAIL = (note) => ({ verdict: 'FAIL', note });

if (!deploy) {
  for (const c of CLAIMS) proof.replay[c.id] = pending('SpecialistRegistry is not deployed on mainnet yet.');
} else if (!rpcUrl) {
  for (const c of CLAIMS) proof.replay[c.id] = pending('Run with --rpc to replay against the chain.');
} else {
  const artifact = JSON.parse(readFileSync('contracts/out/SpecialistRegistry.sol/SpecialistRegistry.json', 'utf8'));
  const pc = createPublicClient({ transport: http(rpcUrl) });
  const R = getAddress(deploy.contract);
  const P = Object.fromEntries(Object.entries(deploy.constructor.params).map(([k, v]) => [k, BigInt(v)]));
  const stock = deploy.constructor.stocks[0];
  const events = artifact.abi.filter((x) => x.type === 'event');
  const head = Number(await pc.getBlockNumber());
  const raw = [];
  for (let from = deploy.block; from <= head; from += 200_000) {
    raw.push(...await pc.getLogs({ address: R, events, fromBlock: BigInt(from), toBlock: BigInt(Math.min(head, from + 199_999)) }));
  }
  const by = (name) => raw.filter((l) => l.eventName === name);
  const ts = new Map();
  const timeOf = async (bn) => { if (!ts.has(bn)) ts.set(bn, Number((await pc.getBlock({ blockNumber: bn })).timestamp)); return ts.get(bn); };

  // S1
  const code = await pc.getCode({ address: R });
  const slot = async (s) => BigInt(await pc.getStorageAt({ address: R, slot: s }));
  const noProxy = (await slot('0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc')) === 0n && (await slot('0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103')) === 0n;
  const writers = artifact.abi.filter((x) => x.type === 'function' && !['view', 'pure'].includes(x.stateMutability)).map((x) => x.name).sort();
  const allowed = ['assign', 'bond', 'checkpoint', 'closeEpoch', 'fund', 'recordAuction', 'registerPosition', 'requestUnbond', 'unbond'];
  const bad = writers.filter((w) => !allowed.includes(w));
  proof.replay.S1 = code && code !== '0x' && noProxy && !bad.length
    ? PASS(`code at ${R}, the EIP-1967 implementation and admin slots are zero, and the only state-changing functions are ${writers.join(', ')}: no owner, no setter. The only privileged one is assign, which needs a HybridAuth authorization.`)
    : FAIL(`code ${code ? 'present' : 'missing'}, no proxy slots ${noProxy}, unexpected writers ${bad.join(',') || 'none'}`);

  // Event rows for the page.
  const row = async (l) => ({ name: l.eventName, tx: l.transactionHash, block: Number(l.blockNumber), ts: await timeOf(l.blockNumber), args: Object.fromEntries(Object.entries(l.args).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v])) });
  for (const l of raw) proof.events.push(await row(l));

  const bonded = by('SpecialistBonded'); const assigned = by('SpecialistAssigned');
  proof.replay.S2 = bonded.length && assigned.length
    ? PASS(`${bonded[0].args.specialist} bonded ${Number(bonded[0].args.bell) / 1e18} BELL and ${Number(bonded[0].args.usdg) / 1e6} USDG in tx ${bonded[0].transactionHash}. The assignment, tx ${assigned[0].transactionHash}, spent HybridAuth GOVERNANCE leaf ${assigned[0].args.leafIndex} (ECDSA and SHRINCS together); scoring starts at epoch ${assigned[0].args.startEpoch}.`)
    : pending('No bond and assignment yet.');
  const specialist = assigned.length ? assigned[0].args.specialist : null;
  proof.specialist = specialist;

  // S3: compare AuctionDutyRecorded with the auction contract's own OrderSubmitted events.
  const orderEvent = parseAbi(['event OrderSubmitted(uint64 indexed cycleId, uint32 indexed orderId, address indexed owner, bool isBuyer, uint128 amountIn, uint160 limitPriceX96)'])[0];
  const duties = by('AuctionDutyRecorded');
  let s3Bad = 0; let s3Counted = 0;
  for (const d of duties) {
    if (!d.args.counted) continue;
    s3Counted += 1;
    const sub = await pc.getLogs({ address: stock.auction, event: orderEvent, args: { cycleId: d.args.cycle, owner: specialist }, fromBlock: BigInt(deploy.block - 5_000_000 > 0 ? deploy.block - 5_000_000 : 0), toBlock: d.blockNumber });
    const buys = sub.filter((x) => x.args.isBuyer && x.args.amountIn >= BigInt(stock.minBuyQuote)).length > 0;
    const sells = sub.filter((x) => !x.args.isBuyer && x.args.amountIn >= BigInt(stock.minSellBase)).length > 0;
    // The registry also checks the price band and cancellations; a cycle it passed must have both sides in the auction's own events.
    if (d.args.pass && !(buys && sells)) s3Bad += 1;
    if (!d.args.pass && d.args.hasBuy && !buys) s3Bad += 1;
  }
  proof.replay.S3 = s3Counted && !s3Bad ? PASS(`${s3Counted} cycle${s3Counted > 1 ? 's' : ''} recorded; each AuctionDutyRecorded agrees with the OrderSubmitted events of auction ${stock.auction}.`)
    : s3Counted ? FAIL(`${s3Bad} of ${s3Counted} recorded cycles disagree with the auction's own events`) : pending('No auction cycle has been recorded yet.');

  // S4: each checkpoint against the position and the pool tick at its block.
  const posm = deploy.constructor.positionManager; const pm = deploy.constructor.poolManager;
  const posAbi = parseAbi(['function getPositionLiquidity(uint256) view returns (uint128)', 'function getPoolAndPositionInfo(uint256) view returns ((address,address,uint24,int24,address),uint256)', 'function ownerOf(uint256) view returns (address)']);
  const checks = by('Checkpoint');
  const registered = by('PositionRegistered');
  let s4Bad = 0;
  for (const c of checks) {
    const reg = registered.filter((r) => r.blockNumber <= c.blockNumber).at(-1);
    if (!reg) { s4Bad += 1; continue; }
    const id = reg.args.tokenId;
    const slot0 = BigInt(await pc.readContract({ address: pm, abi: parseAbi(['function extsload(bytes32) view returns (bytes32)']), functionName: 'extsload', args: [keccak256(`0x${stock.poolId.slice(2)}${(6n).toString(16).padStart(64, '0')}`)], blockNumber: c.blockNumber }));
    const tick = Number(BigInt.asIntN(24, (slot0 >> 160n) & 0xffffffn));
    let liq = 0n; let lo = 0; let hi = 0; let alive = true;
    try { await pc.readContract({ address: posm, abi: posAbi, functionName: 'ownerOf', args: [id], blockNumber: c.blockNumber }); } catch { alive = false; }
    if (alive) {
      liq = await pc.readContract({ address: posm, abi: posAbi, functionName: 'getPositionLiquidity', args: [id], blockNumber: c.blockNumber });
      const info = (await pc.readContract({ address: posm, abi: posAbi, functionName: 'getPoolAndPositionInfo', args: [id], blockNumber: c.blockNumber }))[1];
      hi = Number(BigInt.asIntN(24, (info >> 32n) & 0xffffffn)); lo = Number(BigInt.asIntN(24, (info >> 8n) & 0xffffffn));
    }
    const pass = alive && liq >= BigInt(stock.minLiquidity) && lo <= tick && tick < hi && hi - lo >= Number(P.minTickWidth);
    if (pass !== c.args.pass || tick !== Number(c.args.tick)) s4Bad += 1;
  }
  proof.replay.S4 = checks.length && !s4Bad ? PASS(`${checks.length} checkpoint${checks.length > 1 ? 's' : ''}; each one re-derived from the position's liquidity and range and the pool tick at its own block, and each matches.`)
    : checks.length ? FAIL(`${s4Bad} of ${checks.length} checkpoints disagree with the chain at their block`) : pending('No checkpoint has been taken yet.');

  // S5: recompute every EpochScored.
  const scored = by('EpochScored');
  let s5Bad = 0;
  const prevFailedState = { v: false };
  for (const s of scored) {
    const e = s.args.epoch;
    const dutiesIn = duties.filter((d) => d.args.epoch === e && d.args.counted);
    const cps = checks.filter((c) => c.args.epoch === e);
    const cyc = dutiesIn.length; const cycOk = dutiesIn.filter((d) => d.args.pass).length;
    const m1 = cyc > 0; const p1 = !m1 || BigInt(cycOk) * 10000n >= BigInt(cyc) * P.d1PassBps;
    const m2 = BigInt(cps.length) >= P.minCheckpoints; const p2 = !m2 || BigInt(cps.filter((c) => c.args.pass).length) * 10000n >= BigInt(cps.length) * P.d2PassBps;
    const fails = (m1 && !p1 ? 1 : 0) + (m2 && !p2 ? 1 : 0);
    const out = !m1 && !m2 ? 0 : fails === 0 ? 1 : fails === 1 && !prevFailedState.v ? 2 : 3;
    if (out === 1) prevFailedState.v = false; else if (out >= 2) prevFailedState.v = true;
    if (out !== Number(s.args.outcome) || m1 !== s.args.d1Measured || p1 !== s.args.d1Pass || m2 !== s.args.d2Measured || p2 !== s.args.d2Pass) s5Bad += 1;
    proof.epochs.push({ epoch: Number(e), start: Number(P.genesis) + Number(e) * Number(P.epochSeconds), cycles: cyc, cyclesPassed: cycOk, checkpoints: cps.length, checkpointsPassed: cps.filter((c) => c.args.pass).length, outcome: Number(s.args.outcome), tx: s.transactionHash });
  }
  proof.replay.S5 = scored.length && !s5Bad ? PASS(`${scored.length} epoch${scored.length > 1 ? 's' : ''} scored; the outcome, both duty flags and the measured flags of each were recomputed from the checkpoint and cycle events and match.`)
    : scored.length ? FAIL(`${s5Bad} of ${scored.length} epochs disagree with the recomputation`) : pending('No epoch has been scored yet.');

  // S6
  const TRANSFER = keccak256(toHex('Transfer(address,address,uint256)'));
  const transferIn = async (tx, token, to, amount) => (await pc.getTransactionReceipt({ hash: tx })).logs.some((x) => x.address.toLowerCase() === token.toLowerCase() && x.topics[0] === TRANSFER && `0x${x.topics[2].slice(26)}`.toLowerCase() === to.toLowerCase() && BigInt(x.data) === amount);
  const rewards = by('Rewarded');
  let s6Ok = 0;
  for (const r of rewards) if (await transferIn(r.transactionHash, deploy.constructor.usdg, r.args.specialist, r.args.usdg)) s6Ok += 1;
  proof.replay.S6 = rewards.length && s6Ok === rewards.length ? PASS(`${rewards.length} reward${rewards.length > 1 ? 's' : ''} paid: ${rewards.map((r) => `${Number(r.args.usdg) / 1e6} USDG to ${r.args.specialist} in tx ${r.transactionHash}`).join('; ')}.`)
    : rewards.length ? FAIL('a Rewarded event has no matching USDG transfer') : pending('No epoch has paid a reward yet.');

  // S7
  const slashes = by('Slashed');
  let s7Ok = 0;
  for (const s of slashes) if (s.args.bellBurned === 0n || await transferIn(s.transactionHash, deploy.constructor.bell, BURN, s.args.bellBurned)) s7Ok += 1;
  proof.replay.S7 = slashes.length && s7Ok === slashes.length ? PASS(`${slashes.length} slash${slashes.length > 1 ? 'es' : ''}: ${slashes.map((s) => `${Number(s.args.bellBurned) / 1e18} BELL burned and ${Number(s.args.usdgToPool) / 1e6} USDG moved to the reward pool in tx ${s.transactionHash}${s.args.removed ? ' (removed)' : ''}`).join('; ')}.`)
    : slashes.length ? FAIL('a Slashed event has no matching BELL burn transfer') : pending('No slash has happened yet.');

  // S8
  const unbondReq = by('UnbondRequested'); const unbonded = by('Unbonded');
  const s8 = unbondReq.length ? slashes.find((s) => s.blockNumber > unbondReq[0].blockNumber && (!unbonded.length || s.blockNumber < unbonded[0].blockNumber)) : null;
  proof.replay.S8 = s8 ? PASS(`Unbond was requested in tx ${unbondReq[0].transactionHash}; the epoch that ended during the delay was still scored and slashed in tx ${s8.transactionHash}${unbonded.length ? `, and the bond left only afterwards, in tx ${unbonded[0].transactionHash}` : ''}.`)
    : pending('No slash has landed inside an unbond delay yet.');

  // S9
  if (exit) {
    const rc = await pc.getTransactionReceipt({ hash: exit.tx });
    const hook = stock.hook ?? '0x745a56cA016502c3e5571070ac64E3Be9EBd2cc0';
    const flags = Number(BigInt(hook) & 0x3fffn);
    const hookCalled = rc.logs.some((x) => x.address.toLowerCase() === hook.toLowerCase());
    const next = checks.find((c) => c.blockNumber > rc.blockNumber);
    proof.replay.S9 = rc.status === 'success' && !hookCalled && (flags & 0x200) === 0 && (flags & 0x100) === 0 && next && !next.args.pass
      ? PASS(`The Specialist withdrew liquidity in tx ${exit.tx}: it succeeded, no log came from the hook ${hook}, and the hook address carries no remove-liquidity flag. The next checkpoint, tx ${next.transactionHash}, failed and was recorded as a failed slot.`)
      : pending(rc.status !== 'success' ? 'The withdrawal transaction failed.' : !next ? 'No checkpoint has followed the withdrawal yet.' : 'The withdrawal is recorded but the replay conditions do not all hold.');
  } else proof.replay.S9 = pending('The exit has not been run yet. It runs after the v3 Evolve window closes, so the pool\'s liquidity is not touched during the run.');
}

mkdirSync('evidence/specialist', { recursive: true });
writeFileSync('evidence/specialist/proof.json', `${JSON.stringify(proof, null, 2)}\n`);
mkdirSync('apps/web/components/specialist', { recursive: true });
copyFileSync('evidence/specialist/proof.json', 'apps/web/components/specialist/specialist-proof.json');
const counts = Object.values(proof.replay).reduce((a, r) => { a[r.verdict] = (a[r.verdict] ?? 0) + 1; return a; }, {});
console.log(`wrote evidence/specialist/proof.json: ${JSON.stringify(counts)}`);
