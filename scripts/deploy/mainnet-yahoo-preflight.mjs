#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import {
  preflightYahooMainnet,
} from '../../packages/protocol/src/yahoo-mainnet-preflight.mjs';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';

const MAINNET = Object.freeze({
  AAPL: { token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', directFeed: '0x6B22A786bAa607d76728168703a39Ea9C99f2cD0' },
  NVDA: { token: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', directFeed: '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15' },
  TSLA: { token: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', directFeed: '0x4A1166a659A55625345e9515b32adECea5547C38' },
});
// No Mainnet Yahoo adapter has ever been deployed. These stay null on purpose: a placeholder
// address here would let the script walk all the way into `getBytecode` and fail with a generic
// "adapter not deployed" message after spending Mainnet RPC reads, which reads like a network
// problem rather than "this was never deployed". Supply a real address via env when it exists.
const ADAPTERS = Object.freeze({
  AAPL: { direct: null, regular: null, extended: null, overnight: null },
  NVDA: { direct: null, regular: null, extended: null, overnight: null },
  TSLA: { direct: null, regular: null, extended: null, overnight: null },
});

const SCOPE_KEYS = { 0: 'direct', 1: 'regular', 2: 'extended', 3: 'overnight' };

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function checkFreshness(client, symbol, proxy, blockNumber) {
  const [roundData, decimals] = await Promise.all([
    client.readContract({ address: proxy, abi: [{
      type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [
        { name: 'roundId', type: 'uint80' }, { name: 'answer', type: 'int256' }, { name: 'startedAt', type: 'uint256' },
        { name: 'updatedAt', type: 'uint256' }, { name: 'answeredInRound', type: 'uint80' },
      ],
    }], functionName: 'latestRoundData', blockNumber }),
    client.readContract({ address: proxy, abi: [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }], functionName: 'decimals', blockNumber }),
  ]);
  const updatedAt = Number(roundData[3]);
  const block = await client.getBlock({ blockNumber });
  const ageSeconds = Number(block.timestamp) - updatedAt;
  return { symbol, proxy, answerRaw: roundData[1].toString(), decimals, updatedAt, blockTimestamp: Number(block.timestamp), ageSeconds, suitableFor120sPolicy: roundData[1] > 0n && ageSeconds <= 120 };
}

async function main() {
  const symbol = (process.argv.find(a => a.startsWith('--symbol='))?.slice(9) ?? 'AAPL').toUpperCase();
  const phaseScope = Number(process.argv.find(a => a.startsWith('--scope='))?.slice(8) ?? '0');
  const tokenInfo = MAINNET[symbol];
  if (!tokenInfo) throw new Error(`Unsupported reviewed canonical mainnet symbol ${symbol}`);
  const env = loadEnv(await readFile(new URL('../../.env', import.meta.url), 'utf8'));
  const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
  const privateKey = env.YAHOO_REPORTER_PRIVATE_KEY;
  const verifierAddress = env.YAHOO_SOURCE_VERIFIER_ADDRESS;
  const sourceConfigHash = env[`YAHOO_${symbol}_SCOPE_${phaseScope}_CONFIG_HASH`];
  const expectedReporter = env.YAHOO_REPORTER_ADDRESS;
  if (!rpcUrl) throw new Error('RH_MAINNET_RPC_PRIMARY is required for read-only mainnet preflight');
  const client = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  if (chainId !== 4663) throw new Error(`Wrong chain ${chainId}; expected 4663`);
  const block = await client.getBlock();
  const freshness = await checkFreshness(client, symbol, tokenInfo.directFeed, block.number);
  const scopeKey = SCOPE_KEYS[phaseScope];
  if (!scopeKey) throw new Error(`--scope must be 0, 1, 2 or 3, got ${phaseScope}`);
  const adapterAddress = env[`YAHOO_${symbol}_SCOPE_${phaseScope}_ADAPTER`] ?? ADAPTERS[symbol][scopeKey];
  const result = {
    chainId,
    mainnetBlock: { number: block.number.toString(), hash: block.hash, timestamp: Number(block.timestamp) },
    freeRobinhoodFeed: freshness,
    freeYahoo: null,
    status: 'READ_ONLY_PREFLIGHT',
    mainnetBroadcasted: false,
  };
  if (!privateKey || !verifierAddress || !sourceConfigHash || !expectedReporter) {
    result.freeYahoo = {
      status: 'QUOTE_ONLY_SIGNING_CONFIG_MISSING',
      action: 'Set a dedicated YAHOO_REPORTER_PRIVATE_KEY, deployed YAHOO_SOURCE_VERIFIER_ADDRESS, YAHOO_REPORTER_ADDRESS and per-symbol/scope YAHOO_<SYMBOL>_SCOPE_<N>_CONFIG_HASH locally before signing.',
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!adapterAddress) {
    result.freeYahoo = {
      status: 'ADAPTER_NOT_DEPLOYED',
      action: `No Mainnet Yahoo adapter exists for ${symbol} scope ${phaseScope}. Deploy it and pass YAHOO_${symbol}_SCOPE_${phaseScope}_ADAPTER. No placeholder address is accepted.`,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2;
    return;
  }
  const signed = await preflightYahooMainnet({
    symbol,
    token: tokenInfo.token,
    adapterAddress,
    publicRpcUrl: rpcUrl,
    client,
    reporterPrivateKey: privateKey,
    verifierAddress,
    sourceConfigHash,
    expectedReporter,
    phaseScope,
  });
  result.freeYahoo = signed;
  result.status = 'READ_ONLY_REPORTER_AND_ADAPTER_ACCEPTANCE_PASSED';
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(`Mainnet Yahoo preflight failed: ${error.message}`);
  process.exit(1);
});
