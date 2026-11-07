#!/usr/bin/env node
/**
 * Verify the Elysium testnet contracts that `forge script --verify` does not reach, on the explorer's Blockscout-compatible API
 * (https://testnet.elysium.kinetiq.xyz/api/verify), and write the verification record the v4 CLI reads.
 *
 *   node scripts/deploy/elysium-verify.mjs            verify the extras, then write evidence/deploy/elysium-testnet-verification.json
 *   node scripts/deploy/elysium-verify.mjs --record   only rewrite the record from what is already verified
 *
 * The sixteen contracts of the main deploy were verified by `forge script script/DeployTestnet.s.sol --resume --verify` (see
 * docs/elysium-testnet.md). This file covers what that run cannot see: the dependency reader created inside the policy oracle's
 * constructor, the contracts deployed from Node scripts, and the per-pool hooks and auctions created by the factory.
 *
 * Constructor arguments are read back from the chain, never typed in, so a wrong argument fails loudly instead of "passing".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient, http, encodeAbiParameters, parseAbi, parseAbiParameters } from 'viem';
import HookArtifact from '../../contracts/out/BellHookV2.sol/BellHookV2.json' with { type: 'json' };

const CHAIN_ID = 99801;
const RPC = process.env.ELYSIUM_RPC_URL || 'https://testnet-rpc.elysium.kinetiq.xyz';
const VERIFIER_URL = 'https://testnet.elysium.kinetiq.xyz/api/verify';
const FORGE = process.env.FORGE_BIN || join(homedir(), '.foundry', 'bin', 'forge.exe');
const RECORD = 'evidence/deploy/elysium-testnet-verification.json';
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = json('deployments/elysium-testnet.json');
const adapters = json('evidence/deploy/elysium-testnet-adapters.json');
const rehearsal = json('evidence/deploy/elysium-testnet-rehearsal.json');
const executor = json('evidence/deploy/elysium-testnet-executor.json');
const pools = json('evidence/deploy/elysium-testnet-pools.json').pools;
const client = createPublicClient({ transport: http(RPC, { retryCount: 8, retryDelay: 1500 }) });
// The public RPC sits behind a load balancer: a read can land on a node that has not seen the newest header yet. Retry, never guess.
async function call(opts) {
  for (let i = 0; ; i++) {
    try { return await client.readContract(opts); } catch (e) { if (i >= 12) throw e; await new Promise((r) => setTimeout(r, 2500)); }
  }
}
if ((await client.getChainId()) !== CHAIN_ID) throw new Error(`RPC is not chain ${CHAIN_ID}`);

const prior = existsSync(RECORD) ? json(RECORD) : { verified: {} };
const verified = { ...prior.verified };

// The sixteen contracts verified by the resumed deploy script, read from the manifest.
const FROM_DEPLOY_SCRIPT = ['feeToken', 'testStock', 'safetyController', 'assetRegistry', 'calendarRegistry', 'sessionRegistry', 'poolManager', 'positionManager',
  'policyOracle', 'modeEvaluator', 'auctionRegistry', 'auctionFactoryModule', 'hookDeployer', 'poolFactory', 'weth', 'router'];
for (const k of FROM_DEPLOY_SCRIPT) if (manifest[k]) verified[manifest[k].toLowerCase()] ??= 'accepted';

function verifyOne({ address, id, args = '' }) {
  const a = ['verify-contract', address, id, '--chain', String(CHAIN_ID), '--verifier', 'blockscout', '--verifier-url', VERIFIER_URL, '--skip-is-verified-check', '--watch'];
  if (args) a.push('--constructor-args', args.replace(/^0x/, ''));
  const r = spawnSync(FORGE, a, { cwd: 'contracts', encoding: 'utf8', env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: '1', FOUNDRY_PROFILE: 'elysium_testnet' }, timeout: 600_000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const ok = /successfully verified|already verified/i.test(out) && !/fail|error/i.test(out.split('successfully verified').pop() ?? '');
  console.log(`${ok ? 'verified' : 'FAILED  '} ${id.split(':').pop().padEnd(30)} ${address}`);
  if (!ok) console.log(out.split('\n').filter((l) => /error|fail|mismatch|unable/i.test(l)).slice(0, 4).join('\n'));
  if (ok) verified[address.toLowerCase()] = 'accepted';
  return ok;
}

const enc = (types, values) => encodeAbiParameters(parseAbiParameters(types), values);
const jobs = [];

// 1. Inside the oracle's constructor: no arguments.
jobs.push({ address: manifest.policyDependencyReader, id: 'src/BellPolicyDependencyReader.sol:BellPolicyDependencyReader' });

// 2. Node-deployed contracts.
jobs.push({ address: adapters.verifier, id: 'src/adapters/YahooSourceVerifier.sol:YahooSourceVerifier', args: enc('address', [adapters.reporter]) });
const ADAPTER_ABI = parseAbi(['function sourceConfigHash() view returns (bytes32)', 'function feedId() view returns (bytes32)', 'function phaseScope() view returns (uint8)', 'function directPrice() view returns (bool)', 'function stockToken() view returns (address)']);
const adapterAddrs = [adapters.directAdapter, adapters.regularAdapter, adapters.extendedAdapter, ...Object.values(rehearsal.adapters ?? {})];
for (const address of adapterAddrs) {
  const read = (functionName) => call({ address, abi: ADAPTER_ABI, functionName });
  // One call at a time: the public RPC rate-limits bursts.
  const wire = await read('sourceConfigHash'); const feed = await read('feedId'); const scope = await read('phaseScope'); const direct = await read('directPrice'); const token = await read('stockToken');
  jobs.push({ address, id: 'src/adapters/YahooAttestedSourceAdapter.sol:YahooAttestedSourceAdapter', args: enc('address, bytes32, bytes32, uint8, bool, address', [adapters.verifier, wire, feed, scope, direct, token]) });
}
jobs.push({ address: executor.executor, id: 'src/fixtures/TestnetSwapExecutor.sol:TestnetSwapExecutor', args: enc('address', [manifest.poolManager]) });
jobs.push({ address: rehearsal.stock2, id: 'src/fixtures/TestToken.sol:TestToken', args: enc('string, string, uint8, address, uint256', ['tNVDA (BELL test)', 'tNVDA', 18, manifest.deployer, 1_000n * 10n ** 18n]) });

// 3. Per-pool hooks (CREATE2 from the hook deployer) and auctions (created by the auction factory module).
const HOOK_READ = parseAbi(['function poolKey() view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))']);
const configAbi = HookArtifact.abi.find((e) => e.type === 'function' && e.name === 'config').outputs[0];
const DEPLOYER_READ = parseAbi(['function templateCodeHash() view returns (bytes32)']);
const templateCodeHash = await call({ address: manifest.hookDeployer, abi: DEPLOYER_READ, functionName: 'templateCodeHash' });
const AUCTION_REGISTRY = parseAbi(['function auctionFor(bytes32) view returns (address)']);
const AUCTION_READ = parseAbi([
  'function assetId() view returns (bytes32)', 'function quoteToken() view returns (address)', 'function baseToken() view returns (address)',
  'function auctionLead() view returns (uint32)', 'function settleTimeout() view returns (uint32)', 'function auctionMaximumCycles() view returns (uint32)',
  'function minOrderSizeQuote() view returns (uint128)', 'function minOrderSizeBase() view returns (uint128)', 'function maxOrders() view returns (uint8)',
]);
for (const p of pools) {
  const config = await call({ address: p.hook, abi: HookArtifact.abi, functionName: 'config' });
  const key = await call({ address: p.hook, abi: HOOK_READ, functionName: 'poolKey' });
  const hookArgs = encodeAbiParameters(
    [configAbi, { type: 'tuple', components: HOOK_READ[0].outputs[0].components }, { type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }],
    [config, { ...key, hooks: '0x0000000000000000000000000000000000000000' }, templateCodeHash, manifest.sessionRegistry, manifest.policyOracle, manifest.modeEvaluator, manifest.auctionRegistry],
  );
  jobs.push({ address: p.hook, id: 'src/BellHookV2.sol:BellHookV2', args: hookArgs });
  const auction = p.auction ?? (await call({ address: manifest.auctionRegistry, abi: AUCTION_REGISTRY, functionName: 'auctionFor', args: [p.poolId] }));
  if (auction && auction !== '0x0000000000000000000000000000000000000000') {
    const r = (functionName) => call({ address: auction, abi: AUCTION_READ, functionName });
    const got = []; for (const name of ['assetId', 'quoteToken', 'baseToken', 'auctionLead', 'settleTimeout', 'auctionMaximumCycles', 'minOrderSizeQuote', 'minOrderSizeBase', 'maxOrders']) got.push(await r(name));
    const [assetId, quote, base, lead, settle, cycles, minQ, minB, maxO] = got;
    jobs.push({
      address: auction, id: 'src/auction/BellOpeningAuction.sol:BellOpeningAuction',
      args: enc('address, address, address, bytes32, address, address, uint32, uint32, uint32, uint128, uint128, uint8', [manifest.poolFactory, p.hook, manifest.calendarRegistry, assetId, quote, base, lead, settle, cycles, minQ, minB, maxO]),
    });
  }
}

if (!process.argv.includes('--record')) {
  for (const job of jobs) {
    if (verified[job.address.toLowerCase()]  !== undefined) { console.log(`already  ${job.id.split(':').pop().padEnd(30)} ${job.address}`); continue; }
    verifyOne(job);
  }
}
writeFileSync(RECORD, `${JSON.stringify({ chainId: CHAIN_ID, explorer: 'https://testnet.elysium.kinetiq.xyz', verifierApi: VERIFIER_URL, recordedAt: new Date().toISOString(), verified }, null, 2)}\n`);
console.log(`record: ${Object.keys(verified).length} addresses verified, written to ${RECORD}`);
