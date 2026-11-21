#!/usr/bin/env node
/**
 * Creates and seeds the first Einstein Hooks v2 pool (NVDA/USDG) on Robinhood TESTNET (46630) through the
 * BellPoolFactoryV3, using the PQ stack in evidence/deploy/pq-hooks-mainnet.json.
 *
 * Default is a dry run: it derives the request, mines the hook salt and checks balances, and sends nothing.
 *
 *   node scripts/einstein/create-first-pool.mjs --nvda-usd 200 --usdg 1
 *   node scripts/einstein/create-first-pool.mjs --nvda-usd 200 --usdg 1 --broadcast
 *
 * --nvda-usd  the NVDA price in USD to open the pool at. SESSION_ONLY pools have no price band, so a wrong
 *             price is free money for the first arbitrageur: use a real quote.
 * --usdg      how much USDG to seed. The same value in NVDA is seeded on the other side.
 *
 * The creator is LP_TEST_PRIVATE_KEY. It must not be the service recipient, and it pays 49 USDG on top of the seed.
 * The 49 USDG fee is paid inside createAndSeed, and a revert pays nothing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import FactoryArtifact from '../../contracts/out/BellPoolFactoryV3.sol/BellPoolFactoryV3.json' with { type: 'json' };
import DeployerArtifact from '../../contracts/out/BellHookDeployerV3.sol/BellHookDeployerV3.json' with { type: 'json' };
import { mineHookSalt } from '../tooling/mine-hook-salt.mjs';
import { deriveSqrtPriceFromAmounts, deriveTickBounds, deriveLiquidityForSeed, deriveFlowCaps } from '../deploy/mainnet-pool-config.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const broadcast = process.argv.includes('--broadcast');

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const manifest = JSON.parse(readFileSync('evidence/deploy/pq-hooks-testnet-46630.json', 'utf8'));
const inputs = JSON.parse(readFileSync('evidence/deploy/testnet-46630-pq-inputs.json', 'utf8'));
const c = manifest.contracts;
const USDG = manifest.assetDescriptors.USDG.token;
const NVDA = manifest.assetDescriptors.NVDA.token;
const USDG_ID = manifest.assetDescriptors.USDG.descriptorId;
const NVDA_ID = manifest.assetDescriptors.NVDA.descriptorId;
const NVDA_IS_0 = BigInt(NVDA) < BigInt(USDG); // the pool sorts by address; on testnet tNVDA happens to sort first

const nvdaUsd = Number(arg('nvda-usd', ''));
const usdg = Number(arg('usdg', '1'));
if (!(nvdaUsd > 0)) throw new Error('pass --nvda-usd <price>, a real NVDA quote in USD');
if (!(usdg > 0)) throw new Error('--usdg must be positive');

const rpcUrl = arg('rpc', env.RH_TESTNET_RPC_PRIMARY);
const key = env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl || !key) throw new Error('RH_TESTNET_RPC_PRIMARY and DEPLOYER_PRIVATE_KEY are required in .env');
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== 46630) throw new Error('RPC is not Robinhood testnet (46630)');

const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const factoryAbi = FactoryArtifact.abi;

// Seed amounts in raw units: USDG has 6 decimals, NVDA 18.
const usdgRaw = BigInt(Math.round(usdg * 1e6));
const nvdaRaw = BigInt(Math.round((usdg / nvdaUsd) * 1e9)) * 10n ** 9n;
const amount0 = NVDA_IS_0 ? nvdaRaw : usdgRaw;
const amount1 = NVDA_IS_0 ? usdgRaw : nvdaRaw;
const feeAmount = 49_000_000n;
const serviceRecipient = await publicClient.readContract({ address: c.poolFactory, abi: factoryAbi, functionName: 'serviceRecipient' });
if (serviceRecipient.toLowerCase() === account.address.toLowerCase()) throw new Error('the creator is the service recipient; the factory rejects that');

const [bal0, bal1, eth] = await Promise.all([
  publicClient.readContract({ address: USDG, abi: erc20, functionName: 'balanceOf', args: [account.address] }),
  publicClient.readContract({ address: NVDA, abi: erc20, functionName: 'balanceOf', args: [account.address] }),
  publicClient.getBalance({ address: account.address }),
]);
console.log(`creator ${account.address}`);
console.log(`USDG ${Number(bal0) / 1e6}, NVDA ${Number(bal1) / 1e18}, ETH ${Number(eth) / 1e18}`);
const needUsdg = usdgRaw + feeAmount;
console.log(`need  USDG ${Number(needUsdg) / 1e6} (49 fee + ${usdg} seed), NVDA ${Number(nvdaRaw) / 1e18}`);

const sqrtPriceX96 = deriveSqrtPriceFromAmounts({ amount0, amount1 });
const { tickLower, tickUpper, currentTick } = deriveTickBounds({ sqrtPriceX96, tickSpacing: 60, halfWidth: 6000 });
const liquidity = deriveLiquidityForSeed({ sqrtPriceX96, tickLower, tickUpper, amount0, amount1 });
const caps = deriveFlowCaps({ seed0: amount0, seed1: amount1 });

const profile = {
  token0: NVDA_IS_0 ? NVDA : USDG, token1: NVDA_IS_0 ? USDG : NVDA, asset0: NVDA_IS_0 ? NVDA_ID : USDG_ID, asset1: NVDA_IS_0 ? USDG_ID : NVDA_ID,
  poolManager: inputs.poolManager,
  positionManager: inputs.positionManager,
  factory: c.poolFactory, assetRegistry: c.assetRegistry, calendarRegistry: c.calendarRegistry, safetyController: c.safetyController,
  treasuryAdapter: '0x0000000000000000000000000000000000000000', poolClass: 1, liquidityMode: 0, referenceMode: 0, tickSpacing: 60,
  tradeCap: [...caps.tradeCap], windowCap: [...caps.windowCap], closureCap: [...caps.closureCap],
  policyId: (await import('viem')).keccak256((await import('viem')).stringToHex('bell-einstein-testnet-v1')),
  referenceAdapter0: '0x0000000000000000000000000000000000000000', referenceAdapter1: '0x0000000000000000000000000000000000000000',
};

const nonce = await publicClient.readContract({ address: c.poolFactory, abi: factoryAbi, functionName: 'nonces', args: [account.address] });
const poolKey = { currency0: profile.token0, currency1: profile.token1, fee: 0x800000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' };
const initCodeHash = await publicClient.readContract({ address: c.hookDeployer, abi: DeployerArtifact.abi, functionName: 'initCodeHash', args: [profile, poolKey] });
const mined = mineHookSalt({
  chainId: 46630n, factory: c.poolFactory, creator: account.address, deployer: c.hookDeployer, nonce: BigInt(nonce),
  baseSalt: `0x${'0'.repeat(64)}`, initCodeHash, maxAttempts: 1_000_000,
});
console.log(`hook ${mined.hook} (flags ${mined.hookFlags}, found after ${mined.attempts} tries)`);

const request = {
  config: profile, salt: mined.requestSalt, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 900),
  recipient: account.address, sqrtPriceX96, tickLower, tickUpper, liquidity,
  amountMax: [(amount0 * 105n) / 100n, (amount1 * 105n) / 100n], maxServiceFee: feeAmount,
};
console.log(`price ${nvdaUsd} USD/NVDA, tick ${currentTick}, range ${tickLower}..${tickUpper}, liquidity ${liquidity}`);
console.log(`caps  trade ${caps.tradeCap.join('/')} window ${caps.windowCap.join('/')} closure ${caps.closureCap.join('/')}`);

const short = [];
const usdgMax = NVDA_IS_0 ? request.amountMax[1] : request.amountMax[0]; const nvdaMax = NVDA_IS_0 ? request.amountMax[0] : request.amountMax[1];
if (bal0 < feeAmount + usdgMax) short.push(`USDG: have ${Number(bal0) / 1e6}, need about ${Number(feeAmount + usdgMax) / 1e6} (the 5% headroom is refunded)`);
if (bal1 < nvdaMax) short.push(`NVDA: have ${Number(bal1) / 1e18}, need about ${Number(nvdaMax) / 1e18}`);
if (short.length) {
  console.log(`\nDRY RUN ENDS HERE. Not enough balance to simulate or send:\n- ${short.join('\n- ')}`);
  process.exit(broadcast ? 1 : 0);
}

// The factory pulls the seed and the 49 USDG fee from the creator, so both tokens need an allowance first. An approval to the
// factory for exactly these amounts is harmless, but it is still a transaction, so it only happens with --broadcast.
const log = { startedAt: new Date().toISOString(), creator: account.address, txs: {} };
const approvals = [[USDG, usdgMax + feeAmount, 'approveUSDG'], [NVDA, nvdaMax, 'approveNVDA']];
const missing = [];
for (const [token, need, name] of approvals) {
  const allowance = await publicClient.readContract({ address: token, abi: erc20, functionName: 'allowance', args: [account.address, c.poolFactory] });
  if (allowance < need) missing.push([token, need, name]);
}
if (missing.length && !broadcast) {
  console.log(`\nDRY RUN: allowance is missing for ${missing.map((m) => m[2]).join(', ')}, so the factory call cannot be simulated yet.`);
  console.log('With --broadcast the script approves exactly the amounts above, simulates createAndSeed, and only sends it if the simulation passes.');
  process.exit(0);
}
for (const [token, need, name] of missing) {
  const approveHash = await walletClient.writeContract({ address: token, abi: erc20, functionName: 'approve', args: [c.poolFactory, need] });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  log.txs[name] = approveHash; console.log(`${name} ${approveHash}`);
}
const sim = await publicClient.simulateContract({ address: c.poolFactory, abi: factoryAbi, functionName: 'createAndSeed', args: [request], account });
console.log(`simulation passed, hook ${sim.result.hook}, pool ${sim.result.poolId}`);
const gas = await publicClient.estimateContractGas({ address: c.poolFactory, abi: factoryAbi, functionName: 'createAndSeed', args: [request], account });
console.log(`estimated gas ${gas}`);
if (!broadcast) { console.log('\nDRY RUN OK. Add --broadcast to send.'); process.exit(0); }
const hash =await walletClient.writeContract({ address: c.poolFactory, abi: factoryAbi, functionName: 'createAndSeed', args: [request], gas: (gas * 12n) / 10n });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
log.txs.createAndSeed = hash;
log.block = Number(receipt.blockNumber); log.gasUsed = Number(receipt.gasUsed); log.status = receipt.status;
log.hook = sim.result.hook; log.poolId = sim.result.poolId; log.tokenId = String(sim.result.tokenId);
log.request = { sqrtPriceX96: String(sqrtPriceX96), tickLower, tickUpper, liquidity: String(liquidity), seedUsdg: usdg, nvdaUsd };
const out = `evidence/einstein/testnet-pool-${Date.now()}.json`;
writeFileSync(out, `${JSON.stringify(log, null, 2)}\n`);
console.log(`createAndSeed ${hash} status ${receipt.status} block ${receipt.blockNumber}\nwrote ${out}`);
