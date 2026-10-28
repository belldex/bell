#!/usr/bin/env node
/**
 * BELL price keeper: keeps a live testnet pool actually tradable.
 *
 * Why this exists: without something refreshing quotes, SessionRegistry health expires within
 * ~120 seconds and every pool fails closed. That is correct behaviour, but it means the protocol
 * only works while someone runs the refresh loop. This is that loop.
 *
 * Each tick, for every configured asset:
 *   1. fetch a fresh Yahoo quote (or use --offline for a deterministic rehearsal price)
 *   2. sign it with the reporter key (EIP-712, verifier chainId)
 *   3. publishDirect to the direct adapter
 *   4. submitReports to SessionRegistry
 *   5. refreshHealth
 *   6. refreshState on every live hook that depends on that asset
 *
 * Safety properties:
 *   - Read-only unless --broadcast is passed. Default is a dry run that prints what it would do.
 *   - Never prints private keys, signatures, or raw quotes to logs beyond the derived price.
 *   - Stops on the first hard error instead of looping blindly; the loop is opt-in via --loop.
 *   - A failed refresh is reported, never swallowed, and never reported as healthy.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEther, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { signYahooSourceSample } from '../../packages/protocol/src/yahoo-attestation.mjs';
import { fetchYahooChartQuote } from '../../packages/protocol/src/yahoo-quote.mjs';
import { price18FromYahooQuote, reportValidUntil, resolveSessionRegistry, shouldContinueAfterTickError, transactionGas, yahooSessionPhase, yahooWireForCalendarPhase } from './keeper-price-config.mjs';
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import SessionArtifact from '../../contracts/out/SessionRegistry.sol/SessionRegistry.json' with { type: 'json' };

const ZERO32 = '0x' + '0'.repeat(64);
const MAX_REPORT_AGE_SECONDS = 120;

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function arg(name, fallback = undefined) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const reporterPk = env.YAHOO_REPORTER_PRIVATE_KEY;

if (!rpcUrl) throw new Error('RH_TESTNET_RPC_PRIMARY is required');
if (!reporterPk) throw new Error('YAHOO_REPORTER_PRIVATE_KEY is required');

const broadcast = flag('broadcast');
const loop = flag('loop');
const intervalSeconds = Number(arg('interval', '30'));
const offline = flag('offline');
const offlinePrice = arg('price', '250');
const ledgerPath = arg('ledger', 'evidence/runtime/keeper-price-ticks.jsonl');
const gas = transactionGas(arg('gas'));

const poolEvidencePath = 'evidence/deploy/testnet-pool-created.json';
const stockAdaptersPath = 'evidence/deploy/testnet-stock-adapters.json';
const assetQueuePath = 'evidence/deploy/testnet-46630-asset-queue.json';

const stockAdapters = JSON.parse(readFileSync(stockAdaptersPath, 'utf8'));
const assetQueue = JSON.parse(readFileSync(assetQueuePath, 'utf8'));
const deploymentManifest = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));
const stockAssetId = assetQueue.stock.descriptorId;
const sessionRegistry = resolveSessionRegistry(env, deploymentManifest);
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || stockAdapters.verifier || '0x20a066123c260bc6c5253f75e261c5056fde4bea';

const account = privateKeyToAccount(reporterPk.startsWith('0x') ? reporterPk : `0x${reporterPk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();

const HOOK_ABI = parseAbi([
  'function refreshState() external returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] a, uint128[2] b, uint128[2] c, uint128[2] d, uint128[2] e, uint64 f, uint64 g, bytes32 h, bytes32 i))',
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] a, uint128[2] b, uint128[2] c, uint128[2] d, uint128[2] e, uint64 f, uint64 g, bytes32 h, bytes32 i))',
]);

/** Live hooks that must be refreshed. Read from the pool evidence plus any explicitly passed in. */
function liveHooks() {
  const hooks = [];
  const extra = arg('hooks');
  if (extra) hooks.push(...extra.split(',').map((h) => h.trim()).filter(Boolean));
  if (existsSync(poolEvidencePath)) {
    const ev = JSON.parse(readFileSync(poolEvidencePath, 'utf8'));
    if (ev.hook) hooks.push(ev.hook);
  }
  return [...new Set(hooks.map((h) => h.toLowerCase()))];
}

async function resolvePrice() {
  if (offline) {
    const p = parseEther(offlinePrice);
    return { price18: p, observedAt: 0n, phase: 2, validUntil: BigInt(Math.floor(Date.now() / 1000) + MAX_REPORT_AGE_SECONDS - 1), source: 'offline-rehearsal' };
  }
  let quote;
  try {
    quote = await fetchYahooChartQuote(arg('symbol', 'AAPL'));
    const interval = await publicClient.readContract({
      address: deploymentManifest.calendarRegistry,
      abi: parseAbi(['function currentInterval(bytes32) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']),
      functionName: 'currentInterval',
      args: [stockAssetId],
    });
    const wire = yahooWireForCalendarPhase(stockAdapters, Number(interval.phase));
    const expectedPhase = interval.phase === 1 ? 'PRE' : interval.phase === 2 ? 'REGULAR' : interval.phase === 3 ? 'POST' : null;
    if (!wire || quote.phase !== expectedPhase) {
      const err = new Error(`STALE_SOURCE: Yahoo phase ${quote.phase} does not match active calendar phase ${interval.phase}`);
      err.code = 'STALE_SOURCE';
      throw err;
    }
    quote = { ...quote, streamWire: wire };
  } catch (error) {
    // A closed market is an expected state, not a crash. Report it and let the caller decide.
    const message = String(error?.message ?? error);
    if (/stale/i.test(message)) {
      const err = new Error(`STALE_SOURCE: ${message}`);
      err.code = 'STALE_SOURCE';
      throw err;
    }
    throw error;
  }
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(quote.observedAt));
  if (ageSeconds > MAX_REPORT_AGE_SECONDS) {
    const err = new Error(`STALE_SOURCE: Yahoo quote is ${ageSeconds}s old, exceeds ${MAX_REPORT_AGE_SECONDS}s policy`);
    err.code = 'STALE_SOURCE';
    throw err;
  }
  return {
    price18: price18FromYahooQuote(quote),
    observedAt: BigInt(quote.observedAt),
    phase: yahooSessionPhase(quote.phase),
    streamWire: quote.streamWire,
    validUntil: BigInt(reportValidUntil(Math.floor(Date.now() / 1000), Number(quote.observedAt))),
    source: `yahoo-${quote.phase ?? 'REGULAR'}`,
  };
}

async function tick() {
  const startedAt = new Date().toISOString();
  const block = await publicClient.getBlock();
  const now = Number(block.timestamp);
  const price = await resolvePrice();

  const observedAt = price.observedAt === 0n ? BigInt(now) : price.observedAt;
  const validUntil = price.validUntil;
  const reportHash = keccak256(stringToHex(`bell-keeper-${now}-${price.price18}`));

  const record = {
    startedAt,
    block: Number(block.number),
    chainTime: now,
    price18: price.price18.toString(),
    source: price.source,
    broadcast,
    hooks: liveHooks(),
    steps: [],
  };

  // 1. Direct quote
  const sampleDirect = {
    descriptorId: ZERO32,
    feedId: ZERO32,
    phase: 0,
    price18: price.price18,
    observedAt,
    inputAt: BigInt(now),
    validFrom: observedAt,
    expiresAt: BigInt(now + 300),
    validUntil,
    reportHash,
  };
  const signedDirect = await signYahooSourceSample(sampleDirect, {
    sourceConfigHash: stockAdapters.directWireHash,
    chainId,
    verifier,
    privateKey: reporterPk,
  });

  if (broadcast) {
    const tx = await walletClient.writeContract({
      address: stockAdapters.directAdapter,
      abi: YahooAdapterArtifact.abi,
      functionName: 'publishDirect',
      args: [sampleDirect, signedDirect.signature],
      ...(gas ? { gas } : {}),
    });
    const rc = await publicClient.waitForTransactionReceipt({ hash: tx });
    record.steps.push({ step: 'publishDirect', tx, status: rc.status });
  } else {
    record.steps.push({ step: 'publishDirect', simulated: true });
  }

  // 2. Stream report
  const sampleStream = {
    descriptorId: ZERO32,
    feedId: price.streamWire.wire.feedId,
    phase: price.phase,
    price18: price.price18,
    observedAt,
    inputAt: BigInt(now),
    validFrom: observedAt,
    expiresAt: BigInt(now + 300),
    validUntil,
    reportHash: keccak256(stringToHex(`bell-keeper-stream-${now}-${price.price18}`)),
  };
  const signedStream = await signYahooSourceSample(sampleStream, {
    sourceConfigHash: price.streamWire.wireHash,
    chainId,
    verifier,
    privateKey: reporterPk,
  });

  if (broadcast) {
    const tx = await walletClient.writeContract({
      address: sessionRegistry,
      abi: SessionArtifact.abi,
      functionName: 'submitReports',
      args: [stockAssetId, [signedStream.report]],
      ...(gas ? { gas } : {}),
    });
    const rc = await publicClient.waitForTransactionReceipt({ hash: tx });
    record.steps.push({ step: 'submitReports', tx, status: rc.status });

    const tx2 = await walletClient.writeContract({
      address: sessionRegistry,
      abi: SessionArtifact.abi,
      functionName: 'refreshHealth',
      args: [stockAssetId],
      ...(gas ? { gas } : {}),
    });
    const rc2 = await publicClient.waitForTransactionReceipt({ hash: tx2 });
    record.steps.push({ step: 'refreshHealth', tx: tx2, status: rc2.status });
  } else {
    record.steps.push({ step: 'submitReports', simulated: true });
    record.steps.push({ step: 'refreshHealth', simulated: true });
  }

  // 3. Health readback
  const health = await publicClient.readContract({
    address: sessionRegistry,
    abi: SessionArtifact.abi,
    functionName: 'health',
    args: [stockAssetId],
  });
  record.health = {
    ready: health.ready,
    reasonBits: health.reasonBits.toString(),
    validUntil: health.validUntil.toString(),
  };

  // 4. Refresh every live hook so the pool can trade again
  for (const hook of record.hooks) {
    try {
      if (broadcast) {
        const tx = await walletClient.writeContract({ address: hook, abi: HOOK_ABI, functionName: 'refreshState', ...(gas ? { gas } : {}) });
        const rc = await publicClient.waitForTransactionReceipt({ hash: tx });
        record.steps.push({ step: 'hook.refreshState', hook, tx, status: rc.status });
      }
      const policy = await publicClient.readContract({ address: hook, abi: HOOK_ABI, functionName: 'getPolicy' });
      record.steps.push({
        step: 'hook.getPolicy',
        hook,
        mode: policy.mode,
        canSwap: policy.canSwap,
        reasonBits: policy.reasonBits.toString(),
      });
    } catch (error) {
      record.steps.push({ step: 'hook.refreshState', hook, error: String(error).slice(0, 160) });
    }
  }

  record.finishedAt = new Date().toISOString();
  if (broadcast) {
    appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`);
    // Ops snapshot: the last tick's full state, so a monitor can poll one small file.
    writeFileSync('evidence/runtime/keeper-price-last.json', JSON.stringify(record, null, 2) + '\n');
  }

  const anySwappable = record.steps.some((s) => s.step === 'hook.getPolicy' && s.canSwap);
  console.log(
    `[${startedAt}] block=${record.block} price=${record.price18} health.ready=${health.ready} ` +
      `reasonBits=${health.reasonBits} hooks=${record.hooks.length} canSwap=${anySwappable}`,
  );
  if (!broadcast) console.log('   (dry run: pass --broadcast to send transactions)');
  return record;
}

if (loop) {
  console.log(`Keeper loop: every ${intervalSeconds}s. Ctrl-C to stop. broadcast=${broadcast}`);
  for (;;) {
    try {
      await tick();
    } catch (error) {
      if (shouldContinueAfterTickError(error)) {
        // Expected outside market hours. Do not mark anything fresh, do not pretend it worked.
        console.warn(`[${new Date().toISOString()}] source unavailable: ${String(error.message).slice(0, 160)}`);
      } else {
        console.error('tick failed:', String(error).slice(0, 300));
        throw error;
      }
    }
    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
  }
} else {
  const record = await tick();
  if (!broadcast) {
    console.log(JSON.stringify(record, null, 2).slice(0, 1200));
  }
}
