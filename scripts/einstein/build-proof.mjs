#!/usr/bin/env node
/**
 * Builds evidence/einstein/proof.json, the single source for the proof page and every post. Nothing is typed by hand:
 * addresses come from evidence/deploy/pq-hooks-mainnet.json, transactions from the three calendar state files.
 * With --run it also replays every check against --rpc and records the verdicts and the time.
 *
 *   node scripts/einstein/build-proof.mjs [--run --rpc <url>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runProof, rpcFactory } from './verify-einstein-pool.mjs';

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
    passNote: 'Three governance calls succeeded on SafetyControllerV2, and the GOVERNANCE leaf counter reads 4 (leaves 1 to 3 spent). Roots are queued by the GOVERNANCE role, not REPORTER.',
    checks: [
      ...assets.map((a) => ({ kind: 'txSuccess', label: `${a} calendar root queued`, tx: state[a].governanceQueuedTxHash, to: sc })),
      { kind: 'callWord', label: 'GOVERNANCE next leaf', to: registry, data: GOVERNANCE_CALL, word: 3, equals: 4 },
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

const proof = {
  schema: 1,
  title: 'Einstein Hooks v2: first pool, proof package',
  chain: { id: 4663, name: 'Robinhood Chain', explorer: 'https://robinhoodchain.blockscout.com' },
  generatedFrom: ['evidence/deploy/pq-hooks-mainnet.json', 'evidence/deploy/pq-hooks-mainnet-calendar-state-*.json'],
  contracts: manifest.contracts,
  pool: null,
  claims,
  negatives,
  honestLimits: [
    "Wallets still sign with ECDSA. Only BELL's own governance and reporting calls use the post-quantum layer.",
    'No independent cryptographic review has been done.',
    'No pool uses the Einstein hook yet.',
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
  proof.lastRun = new Date().toISOString();
}
mkdirSync('evidence/einstein', { recursive: true });
const text = `${JSON.stringify(proof, null, 2)}\n`;
writeFileSync('evidence/einstein/proof.json', text);
// The page imports a copy because the web app cannot read outside its own folder; a test keeps the two identical.
writeFileSync('apps/web/components/einstein/proof.json', text);
console.log(`wrote evidence/einstein/proof.json (${claims.length} claims, ${negatives.length} negative tests)${proof.lastRun ? ` run at ${proof.lastRun}` : ''}`);
