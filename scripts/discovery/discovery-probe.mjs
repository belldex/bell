// Discovery probe for an unverified host: identify chainId + head before
// the host may be added to the official endpoint allowlist (M01-03 evidence).
import { probeChainHead } from './rpc-preflight.mjs';

// Ad-hoc client shaped like createRpcClient but WITHOUT the host allowlist,
// because this probe exists precisely to discover whether a new host is official.
function discoveryClient(endpoint) {
  const url = new URL(endpoint);
  let nextId = 1;
  return {
    provider: 'pinax',
    async call(method, params) {
      const id = nextId++;
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401 || response.status === 403) throw new Error('AUTH_OR_ENTITLEMENT ' + response.status);
      if (response.status === 429) throw new Error('QUOTA');
      if (!response.ok) throw new Error('HTTP_' + response.status);
      const payload = await response.json();
      if (payload.error) throw new Error('RPC_ERROR ' + JSON.stringify(payload.error).slice(0, 120));
      return payload.result;
    },
  };
}

const endpoint = process.env.RH_TESTNET_RPC_SECONDARY;
const out = { host: new URL(endpoint).hostname, recordedAt: new Date().toISOString() };
try {
  const client = discoveryClient(endpoint);
  const chainId = await client.call('eth_chainId', []);
  out.chainIdHex = chainId;
  out.chainId = parseInt(chainId, 16);
  const head = await probeChainHead(client, out.chainId);
  out.head = { blockNumber: head.blockNumber.toString(), blockHash: head.blockHash };
  // historical + getLogs capability
  const historicTag = '0x' + (head.blockNumber - 1000n).toString(16);
  const historic = await client.call('eth_getBlockByNumber', [historicTag, false]);
  out.historicalBlockOk = typeof historic === 'object' && !!historic.hash;
  const logs = await client.call('eth_getLogs', [{ address: '0x0000000000000000000000000000000000000001', fromBlock: '0x' + (head.blockNumber - 9n).toString(16), toBlock: head.blockNumber.toString(16) }]);
  out.getLogsOk = Array.isArray(logs);
  out.verdict = out.chainId === 46630
    ? 'SAME_CHAIN_AS_ROBINHOOD_TESTNET_46630'
    : 'DIFFERENT_CHAIN - NOT USABLE AS RH TESTNET SECONDARY';
} catch (error) {
  out.error = { code: String(error.message).slice(0, 60) };
}
console.log(JSON.stringify(out, null, 2));
