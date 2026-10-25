import { fileURLToPath } from 'node:url';
import { createRpcClient } from './rpc-client.mjs';
import { probeChainHead } from './rpc-preflight.mjs';

const ZERO_HASH = `0x${'0'.repeat(64)}`;
const DUMMY_ADDRESS = '0x0000000000000000000000000000000000000001';

async function check(operation) {
  try {
    const value = await operation();
    if (value === null) return { ok: false, code: 'MALFORMED_RESPONSE' };
    return { ok: true, ...(value === undefined ? {} : { value }) };
  } catch (error) {
    return { ok: false, code: error?.code ?? 'PROBE_FAILED' };
  }
}

function parseHexQuantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export async function probeRpcCapabilities({ client, expectedChainId }) {
  if (!client || !['alchemy', 'pinax'].includes(client.provider) || typeof client.call !== 'function') {
    throw new TypeError('capability probe requires an authenticated Alchemy or Pinax client');
  }
  const head = await probeChainHead(client, expectedChainId);
  const latestTag = `0x${head.blockNumber.toString(16)}`;
  const historicalNumber = head.blockNumber > 1000n ? head.blockNumber - 1000n : 0n;
  const historicalTag = `0x${historicalNumber.toString(16)}`;
  const logFrom = head.blockNumber >= 9n ? head.blockNumber - 9n : 0n;
  const logFilter = {
    address: DUMMY_ADDRESS,
    fromBlock: `0x${logFrom.toString(16)}`,
    toBlock: latestTag,
  };

  const [code, nonce, gasPrice, estimateGas, historicalBlock, historicalCall, boundedLogs, receipt] = await Promise.all([
    check(async () => {
      const value = await client.call('eth_getCode', [DUMMY_ADDRESS, latestTag]);
      return typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(value) ? { codePresent: value !== '0x' } : null;
    }),
    check(async () => {
      const value = parseHexQuantity(await client.call('eth_getTransactionCount', [DUMMY_ADDRESS, 'latest']));
      return value === null ? null : { value: value.toString() };
    }),
    check(async () => {
      const value = parseHexQuantity(await client.call('eth_gasPrice', []));
      return value === null ? null : { wei: value.toString() };
    }),
    check(async () => {
      const value = parseHexQuantity(await client.call('eth_estimateGas', [{ from: DUMMY_ADDRESS, to: DUMMY_ADDRESS, data: '0x' }]));
      return value === null ? null : { gas: value.toString() };
    }),
    check(async () => {
      const value = await client.call('eth_getBlockByNumber', [historicalTag, false]);
      if (typeof value?.number !== 'string' || value.number.toLowerCase() !== historicalTag.toLowerCase()
        || !/^0x[0-9a-f]{64}$/i.test(value.hash ?? '')) return null;
      return { blockNumber: historicalNumber.toString(), blockHash: value.hash.toLowerCase() };
    }),
    check(async () => {
      const value = await client.call('eth_call', [{ to: DUMMY_ADDRESS, data: '0x' }, historicalTag]);
      return typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(value) ? { returnedBytes: (value.length - 2) / 2 } : null;
    }),
    check(async () => {
      const value = await client.call('eth_getLogs', [logFilter]);
      return Array.isArray(value) ? { count: value.length, fromBlock: logFilter.fromBlock, toBlock: logFilter.toBlock, maxBlocks: 10 } : null;
    }),
    check(async () => {
      const value = await client.call('eth_getTransactionReceipt', [ZERO_HASH]);
      return value === null || typeof value === 'object' ? { responseShapeValid: true } : null;
    }),
  ]);
  const checks = { code, nonce, gasPrice, estimateGas, historicalBlock, historicalCall, boundedLogs, receipt };
  const complete = Object.values(checks).every((result) => result.ok);
  return Object.freeze({
    schemaVersion: 1,
    kind: 'RPC_CAPABILITY_PREFLIGHT',
    status: complete ? 'CAPABILITIES_OK' : 'CAPABILITY_GAPS',
    provider: client.provider,
    chainId: head.chainId,
    head: Object.freeze({ blockNumber: head.blockNumber.toString(), blockHash: head.blockHash }),
    checks: Object.freeze(checks),
    mainnetBroadcastAllowed: false,
    limitations: Object.freeze([
      'Read-only RPC capability checks do not establish production SLOs, account entitlements, or transaction execution readiness.',
      'eth_estimateGas is a simulation only; no transaction was signed or broadcast.',
    ]),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const networks = [
    { type: 'mainnet', suffix: 'MAINNET', chainId: 4663 },
    { type: 'testnet', suffix: 'TESTNET', chainId: 46630 },
  ];
  const output = {
    schemaVersion: 1,
    kind: 'RPC_CAPABILITY_MATRIX',
    recordedAt: new Date().toISOString(),
    providers: ['alchemy', 'pinax'],
    networks: {},
    mainnetBroadcastAllowed: false,
  };
  for (const network of networks) {
    output.networks[network.type] = {};
    for (const [provider, providerSuffix] of [['alchemy', 'PRIMARY'], ['pinax', 'SECONDARY']]) {
      const endpoint = process.env[`RH_${network.suffix}_RPC_${providerSuffix}`];
      if (!endpoint) {
        output.networks[network.type][provider] = { status: 'BLOCKED_ACCESS', reason: 'MISSING_CREDENTIAL' };
        continue;
      }
      try {
        const client = createRpcClient({ provider, networkType: network.type, endpoint });
        output.networks[network.type][provider] = await probeRpcCapabilities({ client, expectedChainId: network.chainId });
      } catch (error) {
        output.networks[network.type][provider] = { status: 'PROBE_FAILED', code: error?.code ?? 'PROBE_FAILED' };
      }
    }
  }
  console.log(JSON.stringify(output, null, 2));
  if (Object.values(output.networks).some((providers) => Object.values(providers).some((result) => result.status !== 'CAPABILITIES_OK'))) {
    process.exitCode = 2;
  }
}
