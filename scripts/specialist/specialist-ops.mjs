#!/usr/bin/env node
/**
 * Actions on the SpecialistRegistry from the test Specialist wallet (LP_TEST_PRIVATE_KEY) and the deployer. Dry run (a simulation) unless --broadcast.
 *
 *   node scripts/specialist/specialist-ops.mjs status [--label test]
 *   node scripts/specialist/specialist-ops.mjs bond --bell 100 --usdg 1 --broadcast        # approvals, then bond, from the Specialist wallet
 *   node scripts/specialist/specialist-ops.mjs register --token 7 --broadcast               # name the v4 position D2 reads
 *   node scripts/specialist/specialist-ops.mjs fund --usdg 0.5 --from deployer --broadcast  # add USDG to the NVDA reward pool
 *   node scripts/specialist/specialist-ops.mjs unbond-request --broadcast
 *   node scripts/specialist/specialist-ops.mjs unbond --broadcast
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, formatUnits, keccak256, stringToHex, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const cmd = process.argv[2] ?? 'status';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const broadcast = process.argv.includes('--broadcast');
const env = {};
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); } } catch { /* CI */ }
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
const deploy = JSON.parse(readFileSync(`evidence/deploy/specialist-4663-${arg('label', 'test')}.json`, 'utf8'));
const R = getAddress(deploy.contract); const BELL = deploy.constructor.bell; const USDG = deploy.constructor.usdg;
const STOCK = keccak256(stringToHex('NVDA'));
const rpc = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY;
const pc = createPublicClient({ transport: http(rpc) });
const acct = (n) => privateKeyToAccount(env[n].startsWith('0x') ? env[n] : `0x${env[n]}`);
const who = arg('from', 'specialist') === 'deployer' ? acct('RH_MAINNET_DEPLOYER_PRIVATE_KEY') : acct('LP_TEST_PRIVATE_KEY');
const wc = createWalletClient({ account: who, transport: http(rpc) });
const REG = parseAbi([
  'function bond(uint128,uint128)', 'function registerPosition(uint256)', 'function fund(bytes32,uint256)', 'function requestUnbond()', 'function unbond()',
  'function bonds(address) view returns (uint128 bell,uint128 usdg,bytes32 stock,uint64 unbondAt,bool removed)', 'function specialistOf(bytes32) view returns (address)',
  'function positionOf(bytes32) view returns (uint256)', 'function rewardPool(bytes32) view returns (uint256)', 'function startEpoch(bytes32) view returns (uint64)',
  'function nextEpochToClose(bytes32) view returns (uint64)', 'function nextCycleToRecord(bytes32) view returns (uint64)', 'function currentEpoch() view returns (uint64)',
]);
const ERC = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)']);
const send = async (params, gas) => {
  const sim = await pc.simulateContract({ ...params, account: who });
  if (!broadcast) { console.log('simulated ok:', params.functionName); return null; }
  const hash = await wc.writeContract({ ...sim.request, gas });
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${params.functionName} reverted ${hash}`);
  console.log(params.functionName, hash, 'block', Number(r.blockNumber));
  return hash;
};
const approve = async (token, amount) => {
  if ((await pc.readContract({ address: token, abi: ERC, functionName: 'allowance', args: [who.address, R] })) >= amount) return;
  if (!broadcast) return console.log('would approve', token);
  const h = await wc.writeContract({ address: token, abi: ERC, functionName: 'approve', args: [R, amount], gas: 120_000n });
  await pc.waitForTransactionReceipt({ hash: h });
};

if (cmd === 'status') {
  const sp = who.address;
  const [bond, holder, pos, pool, start, close, nextCycle, epoch] = await Promise.all(['bonds', 'specialistOf', 'positionOf', 'rewardPool', 'startEpoch', 'nextEpochToClose', 'nextCycleToRecord'].map((f) => pc.readContract({ address: R, abi: REG, functionName: f, args: f === 'bonds' ? [sp] : [STOCK] })).concat(pc.readContract({ address: R, abi: REG, functionName: 'currentEpoch' })));
  console.log(JSON.stringify({ registry: R, wallet: sp, bondBell: formatUnits(bond[0], 18), bondUsdg: formatUnits(bond[1], 6), assigned: holder, position: String(pos), rewardPoolUsdg: formatUnits(pool, 6), startEpoch: String(start), nextEpochToClose: String(close), nextCycleToRecord: String(nextCycle), currentEpoch: String(epoch), unbondAt: String(bond[3]), removed: bond[4] }, null, 2));
} else if (cmd === 'bond') {
  const b = parseUnits(arg('bell', '100'), 18); const u = parseUnits(arg('usdg', '1'), 6);
  await approve(BELL, b); await approve(USDG, u);
  await send({ address: R, abi: REG, functionName: 'bond', args: [b, u] }, 400_000n);
} else if (cmd === 'register') {
  await send({ address: R, abi: REG, functionName: 'registerPosition', args: [BigInt(arg('token', '7'))] }, 300_000n);
} else if (cmd === 'fund') {
  const u = parseUnits(arg('usdg', '0.5'), 6);
  await approve(USDG, u);
  await send({ address: R, abi: REG, functionName: 'fund', args: [STOCK, u] }, 200_000n);
} else if (cmd === 'unbond-request') {
  await send({ address: R, abi: REG, functionName: 'requestUnbond' }, 150_000n);
} else if (cmd === 'unbond') {
  await send({ address: R, abi: REG, functionName: 'unbond' }, 300_000n);
} else throw new Error(`unknown command ${cmd}`);
