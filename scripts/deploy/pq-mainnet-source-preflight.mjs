import { readFile } from 'node:fs/promises';
import { createPublicClient, http, keccak256, parseAbi } from 'viem';
import { loadEnvFile } from './env-loader.mjs';

const CHAIN_ID = 4663;
const env = loadEnvFile({ filePath: process.env.BELL_ENV_FILE || '.env' });
const manifest = JSON.parse(await readFile('evidence/deploy/mainnet-4663-chainlink-session-adapters.json', 'utf8'));
const providers = [
  ['primary', env.RH_MAINNET_RPC_PRIMARY],
  ['secondary', env.RH_MAINNET_RPC_SECONDARY],
  ['archive', env.RH_MAINNET_ARCHIVE_RPC],
].filter(([, url]) => Boolean(url)).map(([name, url]) => ({ name, client: createPublicClient({ transport: http(url) }) }));
if (providers.length < 2) throw new Error('At least two configured Robinhood Mainnet RPCs are required.');

const chainStates = await Promise.all(providers.map(async ({ name, client }) => {
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  if (chainId !== CHAIN_ID) throw new Error(`${name} RPC returned chain ID ${chainId}.`);
  return { name, client, blockNumber };
}));
const commonBlock = chainStates.reduce((min, state) => state.blockNumber < min ? state.blockNumber : min, chainStates[0].blockNumber);
const aggregatorAbi = parseAbi(['function aggregator() view returns (address)']);
const checks = [];

for (const [symbol, asset] of Object.entries(manifest.assets)) {
  for (const state of chainStates) {
    const [tokenCode, proxyCode, implementation] = await Promise.all([
      state.client.getBytecode({ address: asset.stockToken, blockNumber: commonBlock }),
      state.client.getBytecode({ address: asset.feed, blockNumber: commonBlock }),
      state.client.readContract({ address: asset.feed, abi: aggregatorAbi, functionName: 'aggregator', blockNumber: commonBlock }),
    ]);
    const implementationCode = await state.client.getBytecode({ address: implementation, blockNumber: commonBlock });
    const observed = {
      tokenCodeHash: tokenCode ? keccak256(tokenCode) : null,
      proxyCodeHash: proxyCode ? keccak256(proxyCode) : null,
      implementation,
      implementationCodeHash: implementationCode ? keccak256(implementationCode) : null,
    };
    const expected = {
      tokenCodeHash: asset.tokenCodeHash,
      proxyCodeHash: asset.proxyCodeHash,
      implementation: asset.implementation,
      implementationCodeHash: asset.implementationCodeHash,
    };
    const matches = Object.keys(expected).every((field) => observed[field]?.toLowerCase() === expected[field].toLowerCase());
    checks.push({ rpc: state.name, symbol, matches, expected, observed });
    if (!matches) throw new Error(`${state.name} ${symbol} code or proxy implementation differs from the pinned wire evidence.`);
  }
}

const result = {
  chainId: CHAIN_ID,
  checkedAt: new Date().toISOString(),
  commonBlock: commonBlock.toString(),
  providers: chainStates.map(({ name, blockNumber }) => ({ name, latestBlock: blockNumber.toString() })),
  checks,
  result: 'PASS_CODE_AND_PROXY_IDENTITY_ONLY',
  limitations: [
    'Does not validate quote freshness, Yahoo data rights, or offchain reporter operation.',
    'Does not deploy or broadcast transactions.',
  ],
};
await (await import('node:fs/promises')).writeFile(
  'evidence/deploy/pq-hooks-mainnet-source-preflight.json', `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify({ result: result.result, chainId: result.chainId, commonBlock: result.commonBlock, providers: result.providers, checks: checks.length }));
