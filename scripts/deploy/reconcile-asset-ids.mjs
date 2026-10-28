import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi, keccak256, stringToHex } from 'viem';

// The e2e stages write evidence incrementally, but the queue stage writes assetIds that later stages
// read. After a redeploy the assetIds change. This reconciles the queue evidence with the live chain.
const env = {};
for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const c = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });
const manifest = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));
const adapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const queuePath = 'evidence/deploy/testnet-46630-asset-queue.json';
const q = JSON.parse(readFileSync(queuePath, 'utf8'));

const REG_ABI = parseAbi(['function descriptorIdForToken(address) view returns (bytes32)']);
const ids = {};
for (const [label, token] of [['weth', manifest.weth], ['stock', adapters.stockToken]]) {
  ids[label] = await c.readContract({ address: manifest.assetRegistry, abi: REG_ABI, functionName: 'descriptorIdForToken', args: [token] });
  console.log(`${label} descriptorId on live chain: ${ids[label]}`);
}

let changed = false;
if (q.weth.descriptorId !== ids.weth) { q.weth.descriptorId = ids.weth; changed = true; }
if (q.stock.descriptorId !== ids.stock) { q.stock.descriptorId = ids.stock; changed = true; }
q.weth.token = manifest.weth;
q.stock.token = adapters.stockToken;
q.registryAddress = manifest.assetRegistry;

if (changed) {
  q.reconciledAt = new Date().toISOString();
  q.reconcileNote = 'descriptorIds re-read from the live registry after redeploy';
  writeFileSync(queuePath, JSON.stringify(q, null, 2) + '\n');
  console.log('\nqueue evidence reconciled');
} else {
  console.log('\nqueue evidence already matches the live chain');
}
