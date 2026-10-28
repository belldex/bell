import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// A CalendarRoot for an asset is single-slot: a pending root blocks a new queueRoot, and the root
// itself is immutable. The clean rehearsal path is to mint a fresh stock token each run so the
// assetId is always new. This script redeploys just the stock token and updates the adapter evidence
// so the next admission/calendar stage uses a fresh identity.
const env = {};
for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const c = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });
const w = createWalletClient({ account: privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`), transport: http(env.RH_TESTNET_RPC_PRIMARY) });

const StockArtifact = JSON.parse(readFileSync('contracts/out/AaplRehearsalStockToken.sol/AaplRehearsalStockToken.json', 'utf8'));
console.log('Deploying fresh stock token...');
const tx = await w.deployContract({ abi: StockArtifact.abi, bytecode: StockArtifact.bytecode.object });
const rc = await c.waitForTransactionReceipt({ hash: tx });
console.log('fresh stock token:', rc.contractAddress);

// Update the adapter evidence so admission reads the new token
const path = 'evidence/deploy/testnet-stock-adapters.json';
const ev = JSON.parse(readFileSync(path, 'utf8'));
ev.stockToken = rc.contractAddress;
writeFileSync(path, JSON.stringify(ev, null, 2) + '\n');
console.log('evidence/deploy/testnet-stock-adapters.json updated');
