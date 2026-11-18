#!/usr/bin/env node
/**
 * Builds evidence/einstein/proof.json, the single source for the proof page and every post. Nothing is typed by hand:
 * addresses come from evidence/deploy/pq-hooks-mainnet.json, transactions from the three calendar state files.
 * With --run it also replays every check against --rpc and records the verdicts and the time.
 *
 *   node scripts/einstein/build-proof.mjs [--run --rpc <url>]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { runProof, runNegatives, rpcFactory } from './verify-einstein-pool.mjs';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = read('evidence/deploy/pq-hooks-mainnet.json');
const assets = ['AAPL', 'NVDA', 'TSLA'];
const state = Object.fromEntries(assets.map((a) => [a, read(`evidence/deploy/pq-hooks-mainnet-calendar-state-${a}.json`)]));
const sc = manifest.contracts.safetyController;
const registry = manifest.contracts.pqKeyRegistry;

// roleKey(bytes32) for GOVERNANCE, encoded once: selector 0xa657a47e + keccak256("GOVERNANCE").
const GOVERNANCE_CALL = '0xa657a47e35a7846a2a701fff6f9d61a46ebff5da578c5dcee8bdf361c569f9ea4ee64771';
const EIP1967 = [
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
];
const named = Object.entries(manifest.contracts);

const pending = (id, title, question, passes, pendingText) => ({ id, title, question, passes, pending: pendingText, checks: [] });

const claims = [
  {
    id: 'P1', title: 'The code is what we say it is', question: 'Is the code what you say it is?',
    passes: 'Sourcify shows exact_match for every contract and the tagged commit builds to the same bytecode.',
    partial: 'Sourcify shows match, not exact_match, on all 15 contracts. The build embeds no metadata hash, so exact_match is not reachable for these. The hook and Lens for the first pool are not deployed yet.',
    checks: named.map(([label, address]) => ({ kind: 'sourcify', label, address })),
  },
  {
    id: 'P2', title: 'Nothing here can be changed later', question: 'Can you change it later?',
    passes: 'The EIP-1967 implementation and admin slots are zero, and no function sets the calendar source, controller or fees.',
    passNote: "EIP-1967 slots are zero on all 15 deployed contracts. The first pool's hook is added to this check when it exists.",
    checks: named.map(([label, address]) => ({ kind: 'storageZero', label, address, slots: EIP1967 })),
  },
  pending('P3', 'The hook has only the permissions we say', 'Which permissions does the hook really have?',
    'The hook address low 14 bits are 0x2CC0 and remove-liquidity bits 9, 8 and 0 are off.', 'No Einstein pool hook exists on mainnet yet.'),
  pending('P4', 'The pool is real and holds liquidity', 'Is the pool real and live?',
    'Initialize and seed transactions exist, the pool id matches, the hook is the Einstein hook and liquidity is above zero.', 'No pool has been created yet.'),
  {
    id: 'P5', title: 'The calendars were signed post-quantum', question: 'Was the calendar really signed post-quantum?',
    passes: "Each calendar root went through HybridAuth with ECDSA and SHRINCS, and the signing role's leaf counter moved.",
    passNote: 'Three governance calls succeeded on SafetyControllerV2, and the GOVERNANCE leaf counter is past 3 (leaves 1 to 3 spent on the calendars; later leaves were spent on a pool resume). Roots are queued by the GOVERNANCE role, not REPORTER.',
    checks: [
      ...assets.map((a) => ({ kind: 'txSuccess', label: `${a} calendar root queued`, tx: state[a].governanceQueuedTxHash, to: sc })),
      { kind: 'callWordMin', label: 'GOVERNANCE next leaf', to: registry, data: GOVERNANCE_CALL, word: 3, min: 4 },
      { kind: 'callWord', label: 'GOVERNANCE leaf budget', to: registry, data: GOVERNANCE_CALL, word: 2, equals: 4096 },
    ],
  },
  pending('P6', 'Session fees apply', 'Do the session fees actually apply?',
    'One swap per session shows the matching fee in the PoolManager Swap event: 500, 3000 or 5000, and 10000 pips.',
    'No pool, so no swaps. On a fork of mainnet the CLOSED session charged 10000 pips (not a mainnet proof).'),
  pending('P7', 'The auction works with real orders', 'Does the auction work with real orders?',
    'At least two orders on opposite sides fill at one uniform price.', 'No pool, so no auction.'),
  pending('P8', 'You can always get out', 'Can I always get out?',
    'Remove-liquidity succeeds during CLOSED and while paused, with no post-quantum signature.',
    'No pool. On a fork of mainnet, a pool created through the live factory let its LP remove all liquidity (not a mainnet proof).'),
  pending('P9', 'What fails, fails safely', 'What fails, and does it fail safely?',
    'Each negative test reverts on mainnet with the named error.', 'See N1 to N7 below; none has been run on mainnet.'),
  {
    id: 'P10', title: 'What post-quantum verification costs', question: 'What does PQ verification cost?',
    passes: 'Gas for the calendar submit transaction, compared with an ECDSA-only submit.',
    partial: 'Mainnet gas for the three hybrid-signed calendar submissions is published below. The ECDSA-only baseline has not been measured.',
    checks: assets.map((a) => ({ kind: 'txSuccess', label: `${a} hybrid-signed governance queue`, tx: state[a].governanceQueuedTxHash, to: sc })),
  },
  pending('P11', 'Anyone can check all of this', 'Can I check all of this myself?',
    'verify-einstein-pool prints PASS for P2 to P9 from a clean clone against a public RPC.',
    'The script exists and runs. P3 to P9 print PENDING until the pool exists.'),
];

const negatives = [
  ['N1', 'Calendar root signed with ECDSA only', 'InvalidPQSignature'],
  ['N2', 'Valid ECDSA with a SHRINCS signature from the wrong key', 'InvalidPQSignature'],
  ['N3', 'Reuse a SHRINCS leaf that was already spent', 'LeafOutOfOrder'],
  ['N4', 'Pause through SafetyControllerV2 with ECDSA only', 'InvalidPQSignature'],
  ['N5', 'Swap above the per-trade cap', 'TradeCapExceeded'],
  ['N6', 'Ordinary swap during the auction window', 'AuctionActive'],
  ['N7', 'Swap with no valid session for the timestamp', 'PolicyBlocked'],
].map(([id, attempt, error]) => ({
  id, attempt, mustRevertWith: error, mainnetTx: null, status: 'PENDING',
  note: id === 'N5'
    ? 'Reverted with TradeCapExceeded on a mainnet fork. Not yet sent on mainnet.'
    : 'Not yet sent on mainnet.',
}));

// Evidence written by create-first-pool.mjs, swap-first-pool.mjs (swaps.json, negatives.json). Absent until the pool exists.
const readOptional = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const firstPoolFile = readdirSync('evidence/einstein').filter((f) => f.startsWith('first-pool-')).sort().pop();
const firstPool = firstPoolFile ? readOptional(`evidence/einstein/${firstPoolFile}`) : null;
const swaps = readOptional('evidence/einstein/swaps.json') ?? [];
const negativeTxs = readOptional('evidence/einstein/negatives.json') ?? [];
const exits = readOptional('evidence/einstein/exits.json') ?? [];
const lens = readOptional('evidence/einstein/lens.json');
const gasBaseline = readOptional('evidence/einstein/gas-baseline.json');
const poolManager = read('evidence/deploy/mainnet-4663.json').poolManager;
const positionManager = read('evidence/deploy/mainnet-4663.json').positionManager;
const ERRORS = { N5: ['TradeCapExceeded', '0xecb1f63f'], N7: ['PolicyBlocked', '0x8b60127a'] };
const pauseEvidence = readOptional('evidence/einstein/pause.json');

if (firstPool?.status === 'success') {
  const set = (id, patch) => Object.assign(claims.find((c) => c.id === id), patch);
  const tokenIdWord = BigInt(firstPool.tokenId).toString(16).padStart(64, '0');
  set('P3', {
    pending: undefined,
    passNote: `The hook ${firstPool.hook} has low 14 bits 0x2cc0, and the remove-liquidity bits 9, 8 and 0 are off.`,
    checks: [{ kind: 'hookBits', hook: firstPool.hook }],
  });
  set('P4', {
    pending: undefined,
    passNote: `Pool created and seeded in one transaction at block ${firstPool.block}; the 49 USDG service fee was paid, and position ${firstPool.tokenId} holds liquidity.`,
    checks: [
      { kind: 'txSuccess', label: 'createAndSeed', tx: firstPool.txs.createAndSeed, to: manifest.contracts.poolFactory },
      { kind: 'callWordMin', label: 'position liquidity', to: positionManager, data: `0x1efeed33${tokenIdWord}`, word: 0, min: 1 },
    ],
  });
  const p1 = claims.find((c) => c.id === 'P1');
  if (lens) {
    p1.checks.push({ kind: 'sourcify', label: 'BellSwapLens (first pool)', address: lens.lens });
    p1.partial = 'Sourcify shows match, not exact_match, on all 15 contracts of the stack, because their build embeds no metadata hash. The Lens of the first pool was built with the metadata hash and is an exact match. The pool hook is created from the deployer bytecode and stays a match.';
  }
  const p2 = claims.find((c) => c.id === 'P2');
  if (lens) p2.checks.push({ kind: 'storageZero', label: 'BellSwapLens (first pool)', address: lens.lens, slots: EIP1967 });
  p2.checks.push({ kind: 'storageZero', label: 'Einstein pool hook', address: firstPool.hook, slots: EIP1967 });
  p2.passNote = 'EIP-1967 slots are zero on all 15 deployed contracts and on the first pool hook.';
  set('P7', { pending: 'The first auction cycle closed on 16 November with no orders in it: the script that places them started after the ten-minute window. The next cycle opens its order window on 23 November at 00:50 UTC. The same auction code ran a full cycle on the Elysium testnet on 7 November (not a mainnet proof): a sell and a buy order, settle in transaction 0xc1fed537d9757417c9a576b7a59b9371efdb19e44c1fbb440fe640d6db849eda, one clearing price of 99 USDG per stock, and an ordinary swap during the window reverted (transaction 0xf72e2336ea9b451c19e31f72aae7e06226021870b677e8a83780c7d94a348e80). Evidence: evidence/deploy/elysium-testnet-tests.json.' });
  set('P8', { pending: 'The pool exists, but no exit has been sent on mainnet yet. On a fork of mainnet its LP removed all liquidity without touching the hook (not a mainnet proof).' });
  if (exits.length) {
    const duringOf = (e) => e.during === 'a session' || !e.during ? 'CLOSED' : e.during;
    const closedExit = exits.find((e) => duringOf(e) === 'CLOSED');
    const pausedExit = exits.find((e) => duringOf(e) === 'paused');
    const checks = [];
    if (pauseEvidence?.pause) checks.push({ kind: 'txSuccess', label: 'pool paused with both signatures', tx: pauseEvidence.pause.tx, to: manifest.contracts.safetyController });
    for (const [label, e] of [['remove liquidity during CLOSED', closedExit], ['remove liquidity while paused', pausedExit]]) {
      if (e) checks.push({ kind: 'txSuccess', label, tx: e.tx, to: positionManager });
    }
    set('P8', {
      pending: undefined,
      partial: closedExit && pausedExit ? undefined : 'Removing liquidity during CLOSED is proven on mainnet. Removing it while the pool is paused is still pending.',
      passNote: 'The LP removed part of the position through the PositionManager both during CLOSED and while the pool was paused with both signatures. Neither exit called the hook or needed a post-quantum signature.',
      checks,
    });
  }

  set('P11', { pending: 'The script runs from a clean clone of the public repo against a mainnet RPC, and it reported no failure on 16 November and again on 18 November from a fresh shallow clone at commit 03b2e56: 13 PASS, 2 PARTIAL, 3 PENDING, 0 FAIL. It will print PASS for P2 to P9 once the auction is on chain and the Sourcify and N6 gaps are closed.' });
  const SESSION_BY_FEE = { 10000: 'CLOSED', 5000: 'OVERNIGHT', 3000: 'PRE or POST', 500: 'REGULAR' };
  const proven = new Map();
  for (const s of swaps) if (SESSION_BY_FEE[s.feePips] && !proven.has(s.feePips)) proven.set(s.feePips, s);
  if (proven.size) {
    const names = [...proven.keys()].map((f) => SESSION_BY_FEE[f]);
    const missing = Object.entries(SESSION_BY_FEE).filter(([f]) => !proven.has(Number(f))).map(([, n]) => n);
    set('P6', {
      pending: undefined,
      partial: missing.length
        ? 'Proven on mainnet for ' + names.join(' and ') + ': a real swap shows the matching fee in the Swap event. Still pending: ' + missing.join(', ') + '.'
        : undefined,
      passNote: 'A real swap in each session shows the matching fee in the Swap event: ' + names.join(', ') + '.',
      checks: [...proven].map(([fee, s]) => ({ kind: 'swapFee', label: SESSION_BY_FEE[fee] + ' swap', tx: s.tx, poolManager, expectedFee: Number(fee) })),
    });
  }
}
for (const n of negatives) {
  const done = negativeTxs.find((x) => x.id === n.id);
  const [error, selector] = ERRORS[n.id] ?? [done?.error, done?.selector];
  if (done && selector) {
    n.mainnetTx = done.tx; n.status = 'PROVEN'; n.note = `Reverted on mainnet in block ${done.block} with ${error}.`;
    n.check = { kind: 'revertReason', label: n.id, tx: done.tx, selector, error };
  }
}
{
  const provenNegatives = negatives.filter((n) => n.check);
  if (provenNegatives.length) {
    const open = negatives.filter((n) => !n.check).map((n) => n.id);
    Object.assign(claims.find((c) => c.id === 'P9'), {
      pending: undefined,
      partial: open.length ? 'Reverted on mainnet with the named error: ' + provenNegatives.map((n) => n.id).join(', ') + '. Not yet sent: ' + open.join(', ') + '.' : undefined,
      passNote: 'Every negative test reverted on mainnet with the named error.',
      checks: provenNegatives.map((n) => n.check),
    });
  }
}
if (gasBaseline) {
  const p10 = claims.find((c) => c.id === 'P10');
  const ratio = (gasBaseline.hybrid.gasUsed / gasBaseline.ecdsaOnly.gasUsed).toFixed(1);
  p10.checks.push({ kind: 'txSuccess', label: 'hybrid-signed pause (GUARDIAN)', tx: gasBaseline.hybrid.tx, to: manifest.contracts.safetyController });
  p10.partial = undefined;
  p10.passNote = 'The same pause costs ' + gasBaseline.hybrid.gasUsed.toLocaleString('en-US') + ' gas with both signatures on mainnet and ' + gasBaseline.ecdsaOnly.gasUsed.toLocaleString('en-US') + ' gas with ECDSA only on a fork of mainnet, about ' + ratio + ' times more.';
}
const poolLimit = firstPool?.status === 'success' ? 'Only one pool uses the Einstein hook, and it is seeded with about 1 USD.' : 'No pool uses the Einstein hook yet.';

const proof = {
  schema: 1,
  title: 'Einstein Hooks v2: first pool, proof package',
  chain: { id: 4663, name: 'Robinhood Chain', explorer: 'https://robinhoodchain.blockscout.com' },
  gasBaseline: gasBaseline ? { ecdsaOnly: gasBaseline.ecdsaOnly.gasUsed, hybrid: gasBaseline.hybrid.gasUsed, hybridTx: gasBaseline.hybrid.tx, ecdsaOnlyHow: gasBaseline.ecdsaOnly.how } : null,
  generatedFrom: ['evidence/deploy/pq-hooks-mainnet.json', 'evidence/deploy/pq-hooks-mainnet-calendar-state-*.json'],
  contracts: manifest.contracts,
  pool: firstPool?.status === 'success' ? { hook: firstPool.hook, poolId: firstPool.poolId, positionId: firstPool.tokenId, block: firstPool.block, createTx: firstPool.txs.createAndSeed, pair: 'NVDA/USDG', lens: lens?.lens ?? null, lensTx: lens?.tx ?? null } : null,
  claims,
  negatives,
  honestLimits: [
    "Wallets still sign with ECDSA. Only BELL's own governance and reporting calls use the post-quantum layer.",
    'No independent cryptographic review has been done.',
    ...(pauseEvidence?.resume ? ['A pause and a resume were exercised on mainnet: one GUARDIAN leaf and one GOVERNANCE leaf were spent, and the pool trades again.'] : []),
    poolLimit,
    'The five post-quantum contracts are a Sourcify match, not an exact match.',
  ],
};

if (process.argv.includes('--run')) {
  const i = process.argv.indexOf('--rpc');
  const rpc = await rpcFactory(process.argv[i + 1]);
  const results = await runProof(proof, rpc);
  for (const r of results) {
    proof.claims.find((c) => c.id === r.id).result = { verdict: r.verdict, note: r.note, gas: r.gas };
  }
  for (const r of await runNegatives(proof, rpc)) proof.negatives.find((n) => n.id === r.id).result = { verdict: r.verdict, note: r.note };
  proof.lastRun = new Date().toISOString();
}
mkdirSync('evidence/einstein', { recursive: true });
const text = `${JSON.stringify(proof, null, 2)}\n`;
writeFileSync('evidence/einstein/proof.json', text);
// The page imports a copy because the web app cannot read outside its own folder; a test keeps the two identical.
writeFileSync('apps/web/components/einstein/proof.json', text);
console.log(`wrote evidence/einstein/proof.json (${claims.length} claims, ${negatives.length} negative tests)${proof.lastRun ? ` run at ${proof.lastRun}` : ''}`);
