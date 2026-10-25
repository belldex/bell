// Partial single-provider probe (PARTIAL = no Pinax cross-check yet).
// Evidence for M01-03: authenticated Alchemy Robinhood endpoints.
import { createRpcClient } from './rpc-client.mjs';
import { probeChainHead } from './rpc-preflight.mjs';

const probe = async (label, networkType, expectedChainId, endpoint) => {
  const result = { label, networkType, expectedChainId, endpointHost: new URL(endpoint).hostname, checks: {} };
  try {
    const client = createRpcClient({ provider: 'alchemy', networkType, endpoint });
    // 1. chainId + head
    const t0 = Date.now();
    const head = await probeChainHead(client, expectedChainId);
    result.checks.head = { ok: true, blockNumber: head.blockNumber.toString(), blockHash: head.blockHash, latencyMs: Date.now() - t0 };
    // 2. latency samples on eth_blockNumber (3x)
    const samples = [];
    for (let i = 0; i < 3; i += 1) {
      const s = Date.now();
      await client.call('eth_blockNumber', []);
      samples.push(Date.now() - s);
    }
    result.checks.headLatencySamplesMs = samples;
    // 3. historical block read (head - 1000)
    const historicTag = '0x' + (head.blockNumber - 1000n).toString(16);
    const t1 = Date.now();
    const historic = await client.call('eth_getBlockByNumber', [historicTag, false]);
    result.checks.historicalBlock = {
      ok: typeof historic === 'object' && historic !== null && !!historic.hash,
      blockNumber: historicTag,
      hashMatchesHeight: typeof historic?.hash === 'string' && historic.number === historicTag,
      latencyMs: Date.now() - t1,
    };
    // 4. historical eth_call (dummy address, empty data) at the historic block
    try {
      const t2 = Date.now();
      const out = await client.call('eth_call', [{ to: '0x0000000000000000000000000000000000000001', data: '0x' }, historicTag]);
      result.checks.historicalEthCall = { ok: true, returned: String(out).slice(0, 10), latencyMs: Date.now() - t2 };
    } catch (error) {
      result.checks.historicalEthCall = { ok: false, code: error.code ?? 'UNKNOWN' };
    }
    // 5. getLogs 10-block range (Robinhood Free cap) with empty result expectation
    const fromTag = '0x' + (head.blockNumber - 9n).toString(16);
    const toTag = '0x' + head.blockNumber.toString(16);
    try {
      const t3 = Date.now();
      const logs = await client.call('eth_getLogs', [{ address: '0x0000000000000000000000000000000000000001', fromBlock: fromTag, toBlock: toTag }]);
      result.checks.getLogsTenBlocks = { ok: Array.isArray(logs), count: Array.isArray(logs) ? logs.length : null, latencyMs: Date.now() - t3 };
    } catch (error) {
      result.checks.getLogsTenBlocks = { ok: false, code: error.code ?? 'UNKNOWN' };
    }
    // 6. receipt method entitlement (dummy hash -> null expected)
    try {
      await client.call('eth_getTransactionReceipt', ['0x' + '0'.repeat(64)]);
      result.checks.receiptMethod = { ok: true };
    } catch (error) {
      result.checks.receiptMethod = { ok: false, code: error.code ?? 'UNKNOWN' };
    }
  } catch (error) {
    result.fatal = { code: error.code ?? 'UNKNOWN', message: String(error.message).slice(0, 160) };
  }
  return result;
};

const mainnetUrl = process.env.RH_MAINNET_RPC_PRIMARY;
const testnetUrl = process.env.RH_TESTNET_RPC_PRIMARY;
const out = {
  schemaVersion: 1,
  kind: 'RPC_PARTIAL_PREFLIGHT',
  provider: 'alchemy',
  status: 'PARTIAL',
  crossCheck: 'PENDING_PINAX',
  recordedAt: new Date().toISOString(),
  mainnet: await probe('mainnet', 'mainnet', 4663, mainnetUrl),
  testnet: await probe('testnet', 'testnet', 46630, testnetUrl),
};
console.log(JSON.stringify(out, null, 2));
