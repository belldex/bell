/**
 * Redeploy the three Yahoo adapters against the CURRENT stock token in the evidence file, and
 * rewrite the wire hashes there. This must run after fresh-stock-token.mjs and before admission.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildYahooSourceWire } from '../../packages/protocol/src/yahoo-attestation.mjs';
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };

const env = {};
for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || '0x20a066123c260bc6c5253f75e261c5056fde4bea';
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`);
const c = createPublicClient({ transport: http(rpcUrl) });
const w = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await c.getChainId();
if (chainId !== 46630) throw new Error(`wrong chain ${chainId}`);

const path = 'evidence/deploy/testnet-stock-adapters.json';
const ev = JSON.parse(readFileSync(path, 'utf8'));
const stockToken = ev.stockToken;
const verifierCode = await c.getBytecode({ address: verifier });
if (!verifierCode || verifierCode === '0x') throw new Error('verifier has no code on this chain');
const verifierCodeHash = keccak256(verifierCode);

const results = [];
for (const scope of [0, 1, 2]) {
  const label = scope === 0 ? 'direct' : scope === 1 ? 'regular' : 'extended';
  const wireInfo = buildYahooSourceWire({ chainId, token: stockToken, verifier, verifierCodeHash, phaseScope: scope, symbol: 'AAPL' });
  const isDirect = scope === 0;
  const tx = await w.deployContract({
    abi: YahooAdapterArtifact.abi,
    bytecode: YahooAdapterArtifact.bytecode.object,
    args: [verifier, wireInfo.sourceConfigHash, isDirect ? `0x${'0'.repeat(64)}` : wireInfo.wire.feedId, scope, isDirect, stockToken],
  });
  const rc = await c.waitForTransactionReceipt({ hash: tx });
  if (rc.status !== 'success') throw new Error(`${label} adapter deploy failed`);
  console.log(`${label} adapter: ${rc.contractAddress} wireHash=${wireInfo.sourceConfigHash}`);
  results.push({ scope, label, address: rc.contractAddress, wire: wireInfo.wire, wireHash: wireInfo.sourceConfigHash });
}

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
console.log('\nrebound adapters to the current stock token; evidence updated');
