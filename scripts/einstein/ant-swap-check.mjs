#!/usr/bin/env node
/**
 * Proves the swap-carried ANT update on mainnet: builds the signed update with the Worker's own module, then simulates (and, with --send,
 * sends) a small BellRouter swap on the ANT/USDG pool that carries it. No publisher is running; the swap pays for the report.
 *
 *   node scripts/einstein/ant-swap-check.mjs --pool evidence/einstein/ant-pool-<ts>.json --usdg 0.02            # simulate only
 *   node scripts/einstein/ant-swap-check.mjs --pool ... --usdg 0.02 --send --i-authorize-spend                  # approve and swap
 *
 * The swapper is LP_TEST. --send approves exactly the input amount to the router if the allowance is short.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildAntUpdate } from '../../workers/keeper-b/src/ant-update.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const send = process.argv.includes('--send');
if (send && !process.argv.includes('--i-authorize-spend')) throw new Error('--send needs --i-authorize-spend');
const env = {}; for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const pool = JSON.parse(readFileSync(arg('pool'), 'utf8'));
const manifest = JSON.parse(readFileSync('packages/protocol/generated/abi-manifest.json', 'utf8'));
const dep = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const cfg = JSON.parse(JSON.parse(readFileSync('workers/keeper-b/wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '')).vars.BELL_ANT_CONFIG);
const rpc = env.RH_MAINNET_RPC_PRIMARY;
const pc = createPublicClient({ transport: http(rpc) });
const lp = privateKeyToAccount(env.LP_TEST_PRIVATE_KEY.startsWith('0x') ? env.LP_TEST_PRIVATE_KEY : `0x${env.LP_TEST_PRIVATE_KEY}`);
const wc = createWalletClient({ account: lp, transport: http(rpc) });
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const ERC20 = parseAbi(['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const HOOK = parseAbi(['function config() view returns ((address token0,address token1,bytes32 asset0,bytes32 asset1,address poolManager,address positionManager,address factory,address assetRegistry,address calendarRegistry,address safetyController,address treasuryAdapter,uint8 poolClass,uint8 liquidityMode,uint8 referenceMode,int24 tickSpacing,uint128[2] tradeCap,uint128[2] windowCap,uint128[2] closureCap,bytes32 policyId,address referenceAdapter0,address referenceAdapter1))', 'function configHash() view returns (bytes32)']);

const bundle = await buildAntUpdate({ cfg, delegateKey: env.ANT_DELEGATE_PRIVATE_KEY, client: pc });
console.log(`update: price ${bundle.price} USD, session ${bundle.session}, valid ${bundle.validUntil}`);
const update = {
  assetId: bundle.assetId,
  directSample: Object.fromEntries(Object.entries(bundle.directSample).map(([k, v]) => ['price18', 'observedAt', 'inputAt', 'validFrom', 'expiresAt', 'validUntil', 'phase'].includes(k) ? [k, BigInt(v)] : [k, v])),
  directSignature: bundle.directSignature, reports: bundle.reports, closeBoundaryHash: bundle.closeBoundaryHash,
};
const cfgHash = await pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'configHash' });
const config = await pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'config' });
const zeroForOne = config.token0.toLowerCase() === USDG.toLowerCase(); // sell USDG, buy ANT
const amount = parseUnits(arg('usdg', '0.02'), 6);
const nonce = await pc.readContract({ address: dep.router, abi: manifest.interfaces.IBellRouter, functionName: 'nonces', args: [lp.address] });
const request = {
  hook: pool.hook, zeroForOne, exactInput: true, amountSpecified: amount, limitAmount: 1n,
  sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n,
  recipient: lp.address, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 90),
  expectedConfigHash: cfgHash, wrapInput: false, unwrapOutput: false, unwrapRefund: false, oracleUpdates: [update],
};
const allowance = await pc.readContract({ address: USDG, abi: ERC20, functionName: 'allowance', args: [lp.address, dep.router] });
console.log(`swap ${arg('usdg', '0.02')} USDG -> ANT, router ${dep.router}, allowance ${allowance}`);
if (allowance < amount) {
  if (!send) { console.log('allowance is short; rerun with --send to approve exactly the amount. Not simulated.'); process.exit(0); }
  const h = await wc.writeContract({ address: USDG, abi: ERC20, functionName: 'approve', args: [dep.router, amount], maxFeePerGas: 30_000_000n, maxPriorityFeePerGas: 1_000_000n });
  await pc.waitForTransactionReceipt({ hash: h }); console.log(`approved ${h}`);
}
const sim = await pc.simulateContract({ address: dep.router, abi: manifest.interfaces.IBellRouter, functionName: 'swap', args: [request], account: lp });
console.log(`simulation passed: in ${sim.result[0]}, out ${sim.result[1]}`);
if (!send) process.exit(0);
const hash = await wc.writeContract({ ...sim.request, maxFeePerGas: 30_000_000n, maxPriorityFeePerGas: 1_000_000n });
const r = await pc.waitForTransactionReceipt({ hash });
console.log(`swap ${r.status} ${hash} gasUsed ${r.gasUsed}`);
