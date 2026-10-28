#!/usr/bin/env node
/**
 * One-shot preparation for a fresh pool: deploy a new stock token, mint a large supply to the
 * deployer, rebind the three adapters to it, and approve them to the factory. This makes the pool
 * creation script idempotent on a fresh identity.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildYahooSourceWire } from '../../packages/protocol/src/yahoo-attestation.mjs';
import StockArtifact from '../../contracts/out/AaplRehearsalStockToken.sol/AaplRehearsalStockToken.json' with { type: 'json' };
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}
const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || '0x20a066123c260bc6c5253f75e261c5056fde4bea';
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`);
const c = createPublicClient({ transport: http(rpcUrl) });
const w = createWalletClient({ account, transport: http(rpcUrl) });
const chainId = await c.getChainId();
const MANIFEST = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));

const ERC20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function mint(address,uint256)', 'function decimals() view returns (uint8)']);

// 1. fresh stock token
console.log('Deploying stock token...');
const stx = await w.deployContract({ abi: StockArtifact.abi, bytecode: StockArtifact.bytecode.object });
const src = await c.waitForTransactionReceipt({ hash: stx });
const stockToken = src.contractAddress;
console.log(' stock token:', stockToken);
const mintTx = await w.writeContract({ address: stockToken, abi: StockArtifact.abi, functionName: 'mint', args: [account.address, 10n ** 24n] });
await c.waitForTransactionReceipt({ hash: mintTx });

// 2. rebind adapters
const verifierCode = await c.getBytecode({ address: verifier });
const verifierCodeHash = keccak256(verifierCode);
const results = [];
for (const scope of [0, 1, 2]) {
  const isDirect = scope === 0;
  const wire = buildYahooSourceWire({ chainId, token: stockToken, verifier, verifierCodeHash, phaseScope: scope, symbol: 'AAPL' });
  const tx = await w.deployContract({
    abi: YahooAdapterArtifact.abi, bytecode: YahooAdapterArtifact.bytecode.object,
    args: [verifier, wire.sourceConfigHash, isDirect ? `0x${'0'.repeat(64)}` : wire.wire.feedId, scope, isDirect, stockToken],
  });
  const rc = await c.waitForTransactionReceipt({ hash: tx });
  results.push({ scope, label: scope === 0 ? 'direct' : scope === 1 ? 'regular' : 'extended', address: rc.contractAddress, wire: wire.wire, wireHash: wire.sourceConfigHash });
  console.log(` ${scope === 0 ? 'direct' : scope === 1 ? 'regular' : 'extended'} adapter:`, rc.contractAddress);
}

// 3. update evidence
const path = 'evidence/deploy/testnet-stock-adapters.json';
const ev = JSON.parse(readFileSync(path, 'utf8'));
ev.stockToken = stockToken;
ev.directAdapter = results[0].address;
ev.regularAdapter = results[1].address;
ev.extendedAdapter = results[2].address;
ev.directWire = results[0].wire;
ev.regularWire = results[1].wire;
ev.extendedWire = results[2].wire;
ev.directWireHash = results[0].wireHash;
ev.regularWireHash = results[1].wireHash;
ev.extendedWireHash = results[2].wireHash;
writeFileSync(path, JSON.stringify(ev, null, 2) + '\n');

// 4. clear the stale queue evidence so admission re-reads everything
const qPath = 'evidence/deploy/testnet-46630-asset-queue.json';
if (existsSync(qPath)) {
  const q = JSON.parse(readFileSync(qPath, 'utf8'));
  q.stock.token = stockToken;
  q.stock.descriptorId = `0x${'0'.repeat(64)}`;
  q.stock.directAdapter = results[0].address;
  q.stock.regularAdapter = results[1].address;
  q.stock.extendedAdapter = results[2].address;
  writeFileSync(qPath, JSON.stringify(q, null, 2) + '\n');
}

console.log('\nFresh stock + adapters ready. Run admission next.');
