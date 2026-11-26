#!/usr/bin/env node
/**
 * Gets the run 4 test funds back from the bot wallet: burns the control pool position (all liquidity and the fees it earned go to the bot wallet),
 * then sends every USDG and NVDA the bot wallet holds, and the ETH above a small reserve for the transfers, to one address. Dry run by default.
 *
 *   node scripts/einstein/v3-evolve/mainnet-withdraw.mjs status
 *   node scripts/einstein/v3-evolve/mainnet-withdraw.mjs withdraw --to 0x...             # simulate only
 *   node scripts/einstein/v3-evolve/mainnet-withdraw.mjs withdraw --to 0x... --broadcast
 *
 * Refuses before the window ends (Mon 30 Nov 10:00 ET) unless --force, because pulling the position out early would cut the run short. The BELL pool's own
 * position belongs to the pool creator wallet and is not touched here (see exit-first-pool.mjs).
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, encodeAbiParameters, parseAbiParameters, encodePacked, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const command = process.argv[2] ?? 'status';
const broadcast = process.argv.includes('--broadcast');
const force = process.argv.includes('--force');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const env = {};
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); } } catch { /* CI */ }
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
const cfg = JSON.parse(readFileSync('evidence/einstein/v3-evolve/run-4-config.json', 'utf8'));
const dep = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const rpc = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY;
const bot = privateKeyToAccount(env.V3_EVOLVE_BOT_PRIVATE_KEY.startsWith('0x') ? env.V3_EVOLVE_BOT_PRIVATE_KEY : `0x${env.V3_EVOLVE_BOT_PRIVATE_KEY}`);
const pc = createPublicClient({ transport: http(rpc) });
const wc = createWalletClient({ account: bot, transport: http(rpc) });
const { usdg: USDG, nvda: NVDA } = cfg.tokens;
const [c0, c1] = BigInt(USDG) < BigInt(NVDA) ? [USDG, NVDA] : [NVDA, USDG];
const POSM = dep.positionManager;
const tokenId = BigInt(cfg.pools.control.positionTokenId);
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const posm = parseAbi(['function modifyLiquidities(bytes unlockData,uint256 deadline) payable', 'function getPositionLiquidity(uint256 tokenId) view returns (uint128)', 'function ownerOf(uint256 tokenId) view returns (address)']);

const balances = async () => {
  const [u, n, e] = await Promise.all([pc.readContract({ address: USDG, abi: erc20, functionName: 'balanceOf', args: [bot.address] }), pc.readContract({ address: NVDA, abi: erc20, functionName: 'balanceOf', args: [bot.address] }), pc.getBalance({ address: bot.address })]);
  return { usdg: u, nvda: n, eth: e };
};
const show = (b) => `USDG ${Number(b.usdg) / 1e6}, NVDA ${Number(b.nvda) / 1e18}, ETH ${Number(b.eth) / 1e18}`;

const owner = await pc.readContract({ address: POSM, abi: posm, functionName: 'ownerOf', args: [tokenId] }).catch(() => null);
const liquidity = owner ? await pc.readContract({ address: POSM, abi: posm, functionName: 'getPositionLiquidity', args: [tokenId] }) : 0n;
console.log(`bot wallet ${bot.address}: ${show(await balances())}`);
console.log(`control position #${tokenId}: owner ${owner ?? 'burned'}, liquidity ${liquidity}`);
if (command === 'status') process.exit(0);

const to = arg('to');
if (!to || !isAddress(to)) throw new Error('--to <address> is required');
const now = Math.floor(Date.now() / 1000);
if (now < cfg.window.endTs && !force) throw new Error(`the run ends ${new Date(cfg.window.endTs * 1000).toISOString()}: withdrawing now would cut it short (--force overrides)`);

let burnData = null;
if (owner && liquidity > 0n) {
  if (owner.toLowerCase() !== bot.address.toLowerCase()) throw new Error('the bot wallet does not own the position');
  const burn = encodeAbiParameters(parseAbiParameters('uint256 tokenId,uint128 amount0Min,uint128 amount1Min,bytes hookData'), [tokenId, 0n, 0n, '0x']);
  const take = encodeAbiParameters(parseAbiParameters('address currency0,address currency1,address recipient'), [c0, c1, bot.address]);
  burnData = encodeAbiParameters(parseAbiParameters('bytes actions,bytes[] params'), [encodePacked(['uint8', 'uint8'], [0x03, 0x11]), [burn, take]]);
  const deadline = BigInt(now + 900);
  const sim = await pc.simulateContract({ address: POSM, abi: posm, functionName: 'modifyLiquidities', args: [burnData, deadline], account: bot });
  console.log('burn simulation passed');
  if (broadcast) {
    const gas = await pc.estimateContractGas({ address: POSM, abi: posm, functionName: 'modifyLiquidities', args: [burnData, deadline], account: bot });
    const h = await wc.writeContract({ ...sim.request, gas: (gas * 13n) / 10n });
    const r = await pc.waitForTransactionReceipt({ hash: h });
    if (r.status !== 'success') throw new Error(`burn failed ${h}`);
    console.log(`position burned ${h}`);
  }
}
const b = await balances();
const gasPrice = await pc.getGasPrice();
const reserve = 400_000n * gasPrice * 2n; // two token transfers and room
const sendEth = b.eth > reserve ? b.eth - reserve : 0n;
console.log(`would send to ${to}: USDG ${Number(b.usdg) / 1e6}, NVDA ${Number(b.nvda) / 1e18}, ETH ${Number(sendEth) / 1e18}`);
if (!broadcast) { console.log('dry run: nothing sent'); process.exit(0); }
for (const [t, a, l] of [[USDG, b.usdg, 'USDG'], [NVDA, b.nvda, 'NVDA']]) {
  if (a === 0n) continue;
  const h = await wc.writeContract({ address: t, abi: erc20, functionName: 'transfer', args: [to, a] });
  const r = await pc.waitForTransactionReceipt({ hash: h });
  console.log(`${l} sent ${r.status} ${h}`);
}
const fresh = await balances();
const ethNow = fresh.eth > reserve / 2n ? fresh.eth - reserve / 2n : 0n;
if (ethNow > 0n) { const h = await wc.sendTransaction({ to, value: ethNow }); console.log(`ETH sent ${(await pc.waitForTransactionReceipt({ hash: h })).status} ${h}`); }
console.log(`done: ${show(await balances())}`);
