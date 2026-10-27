#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildYahooSourceSample,
  signYahooSourceSample,
  yahooFeedId,
} from '../../packages/protocol/src/yahoo-attestation.mjs';
import { fetchYahooChartQuote } from '../../packages/protocol/src/yahoo-quote.mjs';

const ZERO32 = `0x${'00'.repeat(32)}`;
const TOKEN_ABI = [{
  type: 'function',
  name: 'uiMultiplier',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ type: 'uint256' }],
}];

function parseArgs(argv) {
  const out = { symbol: 'AAPL', phaseScope: 0, sign: false, broadcast: false, tokenAddress: null, adapter: null, assetId: null, sessionRegistry: null };
  for (const arg of argv) {
    if (arg === '--sign') out.sign = true;
    else if (arg === '--broadcast') { out.sign = true; out.broadcast = true; }
    else if (arg.startsWith('--symbol=')) out.symbol = arg.slice(9).toUpperCase();
    else if (arg.startsWith('--scope=')) out.phaseScope = Number(arg.slice(8));
    else if (arg.startsWith('--token=')) out.tokenAddress = arg.slice(8);
    else if (arg.startsWith('--adapter=')) out.adapter = arg.slice(10);
    else if (arg.startsWith('--asset-id=')) out.assetId = arg.slice(11);
    else if (arg.startsWith('--session-registry=')) out.sessionRegistry = arg.slice(19);
    else if (arg === '--help') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function readEnvFile(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/deploy/yahoo-report.mjs --symbol=AAPL --scope=1 [--token=0x...] [--sign|--broadcast]');
    console.log('For --broadcast also pass --adapter=0x... (scope 0) or --asset-id=0x... --session-registry=0x... (stream scope).');
    console.log('Set a separate YAHOO_REPORTER_PRIVATE_KEY, YAHOO_SOURCE_VERIFIER_ADDRESS, and YAHOO_SOURCE_CONFIG_HASH in local .env.');
    console.log('Scopes: 0=direct token-adjusted, 1=regular, 2=pre/post extended, 3=overnight.');
    return;
  }
  if (![0, 1, 2, 3].includes(args.phaseScope)) throw new Error('--scope must be 0, 1, 2, or 3');

  const env = readEnvFile(await readFile(new URL('../../.env', import.meta.url), 'utf8'));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const quote = await fetchYahooChartQuote(args.symbol, { nowSeconds, maxAgeSeconds: 120 });

  let multiplier18 = '1000000000000000000';
  if (args.phaseScope === 0 && args.tokenAddress) {
    if (!env.RH_MAINNET_RPC_PRIMARY) throw new Error('RH_MAINNET_RPC_PRIMARY is required to read token uiMultiplier');
    const client = createPublicClient({ transport: http(env.RH_MAINNET_RPC_PRIMARY) });
    const chainId = await client.getChainId();
    if (chainId !== 4663) throw new Error(`Expected Robinhood Mainnet 4663, received ${chainId}`);
    multiplier18 = (await client.readContract({ address: args.tokenAddress, abi: TOKEN_ABI, functionName: 'uiMultiplier' })).toString();
  }

  const feedId = args.phaseScope === 0 ? ZERO32 : yahooFeedId(args.symbol, args.phaseScope);
  const sample = buildYahooSourceSample(quote, {
    feedId,
    phaseScope: args.phaseScope,
    nowSeconds,
    tokenMultiplier18: multiplier18,
  });

  const output = {
    mode: args.broadcast ? 'BROADCAST' : args.sign ? 'SIGNED_REPORT' : 'PRICE_PREVIEW_ONLY',
    symbol: quote.symbol,
    currency: quote.currency,
    priceRaw18: quote.priceRaw18,
    observedAt: quote.observedAt,
    ageSeconds: quote.ageSeconds,
    marketPhase: quote.phase,
    source: quote.source,
    sourceSignedByYahoo: false,
    reporterAttestation: null,
    reportSample: {
      descriptorId: sample.descriptorId,
      feedId: sample.feedId,
      phase: sample.phase,
      price18: sample.price18.toString(),
      observedAt: sample.observedAt.toString(),
      inputAt: sample.inputAt.toString(),
      validFrom: sample.validFrom.toString(),
      expiresAt: sample.expiresAt.toString(),
      validUntil: sample.validUntil.toString(),
      reportHash: sample.reportHash,
    },
  };

  if (args.sign) {
    const privateKey = env.YAHOO_REPORTER_PRIVATE_KEY;
    const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS;
    const sourceConfigHash = env.YAHOO_SOURCE_CONFIG_HASH;
    const chainId = Number(env.YAHOO_REPORTER_CHAIN_ID || 4663);
    if (!privateKey || !verifier || !sourceConfigHash) {
      throw new Error('Set YAHOO_REPORTER_PRIVATE_KEY, YAHOO_SOURCE_VERIFIER_ADDRESS, and YAHOO_SOURCE_CONFIG_HASH in local .env; reporter key must be separate from governance/treasury.');
    }
    const signed = await signYahooSourceSample(sample, { sourceConfigHash, chainId, verifier, privateKey });
    output.reporterAttestation = {
      reporter: signed.reporter,
      verifier,
      chainId,
      signature: signed.signature,
      abiReport: signed.report,
    };

    if (args.broadcast) {
      const expectedChainId = chainId;
      const rpcUrl = expectedChainId === 4663 ? env.RH_MAINNET_RPC_PRIMARY : env.RH_TESTNET_RPC_PRIMARY;
      if (!rpcUrl) throw new Error(`RPC URL for chain ${expectedChainId} is missing`);
      const publicClient = createPublicClient({ transport: http(rpcUrl) });
      const actualChainId = await publicClient.getChainId();
      if (actualChainId !== expectedChainId) throw new Error(`Wrong RPC chain ${actualChainId}; expected ${expectedChainId}`);
      const account = privateKeyToAccount(privateKey);
      const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
      let hash;

      if (args.phaseScope === 0) {
        if (!args.adapter) throw new Error('--broadcast direct scope requires --adapter=<YahooAttestedSourceAdapter>');
        hash = await walletClient.writeContract({
          address: args.adapter,
          abi: [{ type: 'function', name: 'publishDirect', stateMutability: 'nonpayable', inputs: [
            { name: 'sample', type: 'tuple', components: [
              { name: 'descriptorId', type: 'bytes32' }, { name: 'feedId', type: 'bytes32' }, { name: 'phase', type: 'uint8' },
              { name: 'price18', type: 'uint128' }, { name: 'observedAt', type: 'uint64' }, { name: 'inputAt', type: 'uint64' },
              { name: 'validFrom', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
              { name: 'reportHash', type: 'bytes32' },
            ] },
            { name: 'signature', type: 'bytes' },
          ], outputs: [] }],
          functionName: 'publishDirect',
          args: [{
            descriptorId: sample.descriptorId, feedId: sample.feedId, phase: sample.phase,
            price18: sample.price18, observedAt: sample.observedAt, inputAt: sample.inputAt,
            validFrom: sample.validFrom, expiresAt: sample.expiresAt, validUntil: sample.validUntil,
            reportHash: sample.reportHash,
          }, signed.signature],
        });
      } else {
        if (!args.assetId || !args.sessionRegistry) throw new Error('--broadcast stream scope requires --asset-id and --session-registry');
        hash = await walletClient.writeContract({
          address: args.sessionRegistry,
          abi: [{ type: 'function', name: 'submitReports', stateMutability: 'nonpayable', inputs: [
            { name: 'assetId', type: 'bytes32' }, { name: 'reports', type: 'bytes[]' },
          ], outputs: [] }],
          functionName: 'submitReports',
          args: [args.assetId, [signed.report]],
        });
      }

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      output.transaction = { hash, blockNumber: receipt.blockNumber.toString(), status: receipt.status };
    }
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(`Yahoo quote/report failed: ${error.message}`);
  process.exit(1);
});
