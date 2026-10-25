const PROVIDERS = new Set(['alchemy', 'pinax']);
const ALLOWED_METHODS = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getLogs',
  'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionReceipt',
]);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const OFFICIAL_ENDPOINTS = Object.freeze({
  alchemy: Object.freeze({
    mainnet: 'robinhood-mainnet.g.alchemy.com',
    testnet: 'robinhood-testnet.g.alchemy.com',
  }),
  pinax: Object.freeze({
    mainnet: 'robinhood.rpc.pinax.network',
    testnet: null,
  }),
});

export class RpcProbeError extends Error {
  constructor(code, message, provider, status = null) {
    super(message);
    this.name = 'RpcProbeError';
    this.code = code;
    this.provider = provider;
    this.status = status;
  }
}

export function createRpcClient({ provider, networkType, endpoint, fetchImpl = globalThis.fetch } = {}) {
  if (!PROVIDERS.has(provider)) throw new TypeError('provider must be alchemy or pinax');
  if (!['mainnet', 'testnet'].includes(networkType)) throw new TypeError('networkType must be mainnet or testnet');
  if (typeof endpoint !== 'string') throw new TypeError('authenticated RPC endpoint is required');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError('RPC endpoint must be an absolute HTTPS URL');
  }
  if (url.port !== '') throw new TypeError('RPC endpoint must use the default HTTPS port');
  if (url.protocol !== 'https:' || !url.hostname || url.hash || url.username || url.password || url.search) {
    throw new TypeError('RPC endpoint must be an HTTPS URL without userinfo, query, or fragment');
  }
  const officialHost = OFFICIAL_ENDPOINTS[provider][networkType];
  if (!officialHost) throw new Error(`${provider} ${networkType} endpoint host is not verified for this chain`);
  if (url.hostname.toLowerCase() !== officialHost) throw new Error('RPC host does not match the official Robinhood endpoint for this provider');
  const segments = url.pathname.split('/').filter(Boolean);
  const credentialRoute = provider === 'alchemy'
    ? segments.length === 2 && segments[0] === 'v2' && segments[1].length > 0
    : segments.length === 2 && segments[0] === 'v1' && segments[1].length > 0;
  if (!credentialRoute) throw new Error('RPC endpoint must use the provider credential path format');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is unavailable');

  let nextId = 1;
  return Object.freeze({
    provider,
    async call(method, params) {
      if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
        throw new RpcProbeError('METHOD_NOT_ALLOWED', 'RPC method is outside the bounded preflight allowlist', provider);
      }
      if (!Array.isArray(params)) throw new TypeError('JSON-RPC params must be an array');
      const id = nextId++;
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        });
      } catch {
        throw new RpcProbeError('NETWORK_OR_TIMEOUT', 'Authenticated RPC request failed or timed out', provider);
      }
      if (response.status === 401 || response.status === 403) {
        throw new RpcProbeError('AUTH_OR_ENTITLEMENT', 'RPC credentials or method entitlement were rejected', provider, response.status);
      }
      if (response.status === 429) throw new RpcProbeError('QUOTA', 'RPC provider quota/rate limit was reached', provider, 429);
      if (!response.ok) throw new RpcProbeError('HTTP_ERROR', `RPC provider returned HTTP ${response.status}`, provider, response.status);

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new RpcProbeError('RESPONSE_TOO_LARGE', 'RPC response exceeded the 1 MiB probe bound', provider);
      let payload;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new RpcProbeError('INVALID_JSON', 'RPC provider returned invalid JSON', provider);
      }
      if (!payload || payload.jsonrpc !== '2.0' || payload.id !== id) {
        throw new RpcProbeError('RESPONSE_MISMATCH', 'RPC response version or request ID did not match', provider);
      }
      if (payload.error) {
        const code = payload.error.code === -32601 ? 'METHOD_UNSUPPORTED' : 'RPC_ERROR';
        throw new RpcProbeError(code, `RPC method ${method} failed with code ${payload.error.code}`, provider);
      }
      if (!Object.hasOwn(payload, 'result')) throw new RpcProbeError('MALFORMED_RESPONSE', 'RPC response omitted result', provider);
      return payload.result;
    },
  });
}
