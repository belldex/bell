#!/usr/bin/env node
/**
 * Keeps a v3 pool moving through halts. Everything it calls is permissionless and carries no authority: it cannot halt, resume or renew
 * (those are hybrid-signed by the REPORTER), it only commits state the registry has already decided.
 *
 *   refreshState  after a halt starts or ends, so the closure is latched or released; a swap reverts with PolicyBlocked until this runs
 *   armResume     when the registry shows the resume window, so the reopening auction opens for orders
 *   settle        when the auction window has closed (stage LOCKED), so swaps reopen; an empty book closes empty
 *
 *   node scripts/einstein/halt-keeper.mjs tick --pool evidence/einstein/testnet-ant-pool-<ts>.json [--broadcast]
 *   node scripts/einstein/halt-keeper.mjs loop --pool ... --every 20 --broadcast
 *
 * Default is a dry run that prints what it would do. --network mainnet needs --i-authorize-spend. The sender only pays gas.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const command = process.argv[2] ?? 'tick';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const broadcast = process.argv.includes('--broadcast');
const MAINNET = arg('network', 'testnet') === 'mainnet';
if (MAINNET && broadcast && !process.argv.includes('--i-authorize-spend')) throw new Error('a mainnet broadcast needs --broadcast --i-authorize-spend');
const env = {}; for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const pool = JSON.parse(readFileSync(arg('pool'), 'utf8'));
const halt = JSON.parse(readFileSync(MAINNET ? 'evidence/deploy/halt-stack-4663.json' : 'evidence/deploy/halt-stack-testnet-46630.json', 'utf8'));
const state = JSON.parse(readFileSync(arg('state', MAINNET ? 'evidence/deploy/mainnet-4663-ant.json' : 'evidence/deploy/testnet-46630-ant-delegated.json'), 'utf8'));
const ASSET = state.admittedDescriptorId;
const rpc = MAINNET ? env.RH_MAINNET_RPC_PRIMARY : env.RH_TESTNET_RPC_PRIMARY;
const pk = MAINNET && env.RH_MAINNET_DEPLOYER_PRIVATE_KEY ? env.RH_MAINNET_DEPLOYER_PRIVATE_KEY : env.DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const pc = createPublicClient({ transport: http(rpc) });
const wc = createWalletClient({ account, transport: http(rpc) });

const REG = parseAbi(['function phase(bytes32) view returns (uint8)']);
const AUCTION = parseAbi(['function armResume() returns (bool)', 'function settle()', 'function currentStage() view returns (uint8)', 'function blocksSwaps() view returns (bool)', 'function cycleId() view returns (uint64)']);
const AUCTION_REG = parseAbi(['function auctionFor(bytes32) view returns (address)']);
const HOOK = parseAbi([
  'function refreshState() returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
  'function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
  'function state() view returns ((uint8 lifecycle,uint8 mode,bool closedLatched,uint64 closureNonce,uint64 bellStart,uint64 corporateUntil,uint64 reopenCandidateAt,uint64 oldValidUntil,uint64[2] reopenBaseObservations,uint64[2] lastOpenObservations))',
]);
const MODE = ['HALTED', 'ACTIVE', 'CLOSED', 'RECOVERING', 'SETUP'];
const PHASE = ['NORMAL', 'HALTED', 'RESUME_AUCTION'];
const STAGE = ['IDLE', 'ARMED', 'OPEN', 'LOCKED', 'SETTLED', 'REFUNDED'];

const send = async (label, params) => {
  if (!broadcast) { console.log(`  would ${label}`); return null; }
  const { request } = await pc.simulateContract({ ...params, account });
  const hash = await wc.writeContract({ ...request, gas: 3_000_000n });
  const r = await pc.waitForTransactionReceipt({ hash });
  console.log(`  ${label}: ${r.status} ${hash}`);
  return hash;
};

export async function tick() {
  const auction = await pc.readContract({ address: halt.contracts.auctionRegistry, abi: AUCTION_REG, functionName: 'auctionFor', args: [pool.poolId] });
  const phase = PHASE[await pc.readContract({ address: halt.contracts.haltRegistry, abi: REG, functionName: 'phase', args: [ASSET] })];
  const view = await pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'getPolicy' });
  const st = await pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'state' });
  const stage = STAGE[await pc.readContract({ address: auction, abi: AUCTION, functionName: 'currentStage' })];
  console.log(`registry ${phase}, hook ${MODE[view.mode]} (latched ${st.closedLatched}, canSwap ${view.canSwap}), auction ${stage}`);
  const did = [];

  // 1. Commit the closure (or its release) whenever the projected mode differs from the stored one.
  const storedMode = MODE[st.mode];
  if (MODE[view.mode] !== storedMode || (phase !== 'NORMAL' && !st.closedLatched) || (phase === 'NORMAL' && st.closedLatched && view.mode !== 2)) {
    const tx = await send('refreshState', { address: pool.hook, abi: HOOK, functionName: 'refreshState' });
    did.push(['refreshState', tx]);
  }
  // 2. Open the reopening auction for the resume window.
  if (phase === 'RESUME_AUCTION' && stage !== 'OPEN') {
    const tx = await send('armResume', { address: auction, abi: AUCTION, functionName: 'armResume' });
    did.push(['armResume', tx]);
  }
  // 3. Close the auction once the order window is over.
  if (stage === 'LOCKED') {
    const tx = await send('settle', { address: auction, abi: AUCTION, functionName: 'settle' });
    did.push(['settle', tx]);
  }
  if (!did.length) console.log('  nothing to do');
  return did;
}

if (import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  if (command === 'tick') await tick();
  else if (command === 'loop') {
    const every = Number(arg('every', '20')) * 1000;
    for (;;) { try { await tick(); } catch (e) { console.log(`  tick failed: ${String(e.shortMessage ?? e.message).split('\n')[0]}`); } await new Promise((r) => setTimeout(r, every)); }
  } else throw new Error('usage: halt-keeper.mjs tick|loop --pool <pool json>');
}
