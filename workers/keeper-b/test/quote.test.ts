import { ContractFunctionRevertedError, BaseError, encodeErrorResult, decodeAbiParameters, parseAbiParameters, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({ phase: 2, chainId: 4663, nextPhase: 5, nextStart: 1_800_001_000n, direct: 0n, stream: 0n, directError: null, writes: vi.fn(), wallet: vi.fn() }));
vi.mock('viem', async (original) => ({ ...await original(),
  createPublicClient: () => ({ getChainId: async () => rpc.chainId, getBlockNumber: async () => 100n, request: async () => [], getLogs: async () => [], readContract: async ({ functionName }) => {
    if (functionName === 'currentInterval') return { phase: rpc.phase, start: 1_799_999_000n, end: 1_800_001_000n };
    if (functionName === 'nextInterval') return { assetId: `0x${'1'.repeat(64)}`, year: 2026, index: 1, start: rpc.nextStart, end: rpc.nextStart + 600n, phase: rpc.nextPhase, provenanceHash: `0x${'aa'.repeat(32)}` };
    if (functionName === 'readCurrent') { if (rpc.directError) throw rpc.directError; return { observedAt: rpc.direct }; }
    if (functionName === 'latestSample') return { observedAt: rpc.stream };
    throw new Error(`unexpected read ${functionName}`);
  } }),
  createWalletClient: (...args) => { rpc.wallet(...args); return { writeContract: rpc.writes }; },
}));
vi.mock('@bell/protocol/yahoo-quote', () => ({ fetchYahooChartQuote: async symbol => ({ symbol, phase: 'REGULAR', observedAt: 1_799_999_950, priceRaw18: '1000000000000000000' }) }));
const { default: worker, runQuote, runTick, KeeperState } = await import('../src/index');
const { hashCalendarLeaf } = await import('@bell/protocol/calendar');
const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const symbols = ['AAPL', 'NVDA', 'TSLA'];
const env = {
  BELL_ORACLE_MODE: 'pull', BELL_EXPECTED_CHAIN_ID: '4663', BELL_RPC_URL: 'https://rpc.test',
  BELL_POOL_FACTORY: `0x${'ab'.repeat(20)}`, BELL_POOL_SCAN_FROM_BLOCK: '1',
  YAHOO_REPORTER_PRIVATE_KEY: key,
  BELL_CALENDAR_REGISTRY: `0x${'11'.repeat(20)}`, BELL_SESSION_REGISTRY: `0x${'22'.repeat(20)}`,
  YAHOO_SOURCE_VERIFIER_ADDRESS: `0x${'33'.repeat(20)}`,
  BELL_STOCK_ASSETS: JSON.stringify(symbols.map((symbol, i) => ({ symbol, assetId: `0x${String(i + 1).repeat(64)}` }))),
  BELL_MAINNET_ASSETS: JSON.stringify(Object.fromEntries(symbols.map(symbol => [symbol, {
    directAdapter: `0x${'44'.repeat(20)}`, directWireHash: `0x${'55'.repeat(32)}`,
    regularWire: { feedId: `0x${'66'.repeat(32)}` }, regularWireHash: `0x${'77'.repeat(32)}`,
    extendedWire: { feedId: `0x${'88'.repeat(32)}` }, extendedWireHash: `0x${'99'.repeat(32)}`,
  }]))),
};
const quote = (symbol = 'AAPL', overrides = {}) => ({ symbol, phase: 'REGULAR', observedAt: 1_799_999_950, priceRaw18: '1000000000000000000', ...overrides });
const options = (overrides = {}) => ({ nowSeconds: 1_800_000_000, fetchQuote: async symbol => quote(symbol), ...overrides });
beforeEach(() => { rpc.phase = 2; rpc.chainId = 4663; rpc.nextPhase = 5; rpc.nextStart = 1_800_001_000n; rpc.direct = 0n; rpc.directError = null; rpc.stream = 0n; rpc.writes.mockClear(); rpc.wallet.mockClear(); });
describe('read-only pull quote bundles', () => {
  it('uses one captured timestamp for quote parsing and report freshness', async () => {
    const fetchQuote = vi.fn(async (symbol, { nowSeconds }) => quote(symbol, { observedAt: nowSeconds }));
    const result = await runQuote(env, 'AAPL', options({ fetchQuote }));
    expect(fetchQuote).toHaveBeenCalledWith('AAPL', { nowSeconds: 1_800_000_000 });
    expect(result.directSample.observedAt).toBe('1800000000');
  });
  it('binds the signed quote to a planned market-free interval during the final five minutes', async () => {
    const nowSeconds = 1_800_000_800;
    const result = await runQuote(env, 'AAPL', options({ nowSeconds, fetchQuote: async () => quote('AAPL', { observedAt: nowSeconds - 10 }) }));
    expect(result.closeBoundaryHash).toBe(hashCalendarLeaf({
      chainId: 4663, calendarRegistry: env.BELL_CALENDAR_REGISTRY, assetId: `0x${'1'.repeat(64)}`,
      year: 2026, index: 1, start: 1_800_001_000n, end: 1_800_001_600n, phase: 5,
      provenanceHash: `0x${'aa'.repeat(32)}`,
    }));
  });
  it.each(symbols)('signs an ABI-friendly bundle for %s without a transaction key', async symbol => {
    const result = await runQuote(env, symbol, options());
    expect(result.assetId).toBe(`0x${String(symbols.indexOf(symbol) + 1).repeat(64)}`);
    expect(result.directSample.price18).toBe('1000000000000000000');
    expect(result.directSample.observedAt).toBe('1799999950');
    expect(result.directSample.phase).toBe('0');
    const fields = [
      ['sourceConfigHash', 'bytes32'], ['feedId', 'bytes32'], ['phase', 'uint8'], ['price18', 'uint128'],
      ['observedAt', 'uint64'], ['inputAt', 'uint64'], ['validFrom', 'uint64'], ['expiresAt', 'uint64'],
      ['validUntil', 'uint64'], ['reportHash', 'bytes32'],
    ].map(([name, type]) => ({ name, type }));
    const recover = (sample, signature, sourceConfigHash) => recoverTypedDataAddress({
      domain: { name: 'BELL Yahoo Quote Reporter', version: '1', chainId: 4663, verifyingContract: env.YAHOO_SOURCE_VERIFIER_ADDRESS },
      types: { YahooQuote: fields }, primaryType: 'YahooQuote', message: { ...sample, sourceConfigHash }, signature,
    });
    expect(await recover(result.directSample, result.directSignature, `0x${'55'.repeat(32)}`)).toBe(privateKeyToAccount(key).address);
    const [stream, signature] = decodeAbiParameters(parseAbiParameters('(bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash),bytes'), result.reports[0]);
    expect(stream.phase).toBe(2);
    expect(stream.feedId).toBe(`0x${'66'.repeat(32)}`);
    expect(stream.observedAt).toBe(1_799_999_950n);
    expect(await recover(stream, signature, `0x${'77'.repeat(32)}`)).toBe(privateKeyToAccount(key).address);
    expect(result.directSignature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatch(/^0x[0-9a-f]+$/i);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(rpc.wallet).not.toHaveBeenCalled();
    expect(rpc.writes).not.toHaveBeenCalled();
  });
  it.each([[1, 'PRE'], [3, 'POST']])('uses the extended wire for phase %s', async (phase, yahooPhase) => {
    rpc.phase = phase;
    const result = await runQuote(env, 'AAPL', options({ fetchQuote: async () => quote('AAPL', { phase: yahooPhase }) }));
    const [stream] = decodeAbiParameters(parseAbiParameters('(bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash),bytes'), result.reports[0]);
    expect(stream.phase).toBe(phase);
    expect(stream.feedId).toBe(`0x${'88'.repeat(32)}`);
  });
  it('bootstraps only the documented BadSample custom revert from an empty direct adapter', async () => {
    const abi = [{ type: 'error', name: 'BadSample', inputs: [] }];
    rpc.directError = new BaseError('readCurrent failed', { cause: new ContractFunctionRevertedError({ abi, data: encodeErrorResult({ abi, errorName: 'BadSample' }), functionName: 'readCurrent' }) });
    expect(await runQuote(env, 'AAPL', options())).toMatchObject({ assetId: `0x${'1'.repeat(64)}` });
  });
  it.each(['RPC unavailable', 'BadSample'])('propagates ordinary read failures: %s', async message => {
    rpc.directError = new Error(message);
    await expect(runQuote(env, 'AAPL', options())).rejects.toThrow(message);
  });
  it('rejects unknown symbols', async () => { await expect(runQuote(env, 'MSFT', options())).rejects.toThrow(/symbol/i); });
  it('disables Worker-signed stock quotes when contracts read Chainlink feeds directly', async () => {
    await expect(runQuote({ ...env, BELL_ORACLE_MODE: 'chainlink' }, 'AAPL', options())).rejects.toThrow(/onchain Chainlink/i);
  });
  it.each([0, 4, 5])('rejects unsupported calendar phase %s', async phase => { rpc.phase = phase; await expect(runQuote(env, 'AAPL', options())).rejects.toThrow(/phase/); });
  it.each([{ observedAt: 1_799_999_880 }, { phase: 'PRE' }, { symbol: 'NVDA' }, { observedAt: 1_800_000_001 }])('rejects stale or mismatched quote %j', async overrides => {
    await expect(runQuote(env, 'AAPL', options({ fetchQuote: async () => quote('AAPL', overrides) }))).rejects.toThrow();
  });
  it.each(['direct', 'stream'])('refuses observations already consumed by %s', async source => {
    rpc[source] = 1_799_999_950n;
    await expect(runQuote(env, 'AAPL', options())).rejects.toThrow(/observation/);
    rpc[source]++;
    await expect(runQuote(env, 'AAPL', options())).rejects.toThrow(/observation/);
  });
  it('rejects the wrong chain', async () => { rpc.chainId = 46630; await expect(runQuote(env, 'AAPL', options())).rejects.toThrow(/chain/); });
  it('disables push entry points and cancels persisted alarm loops in pull mode', async () => {
    expect(await runTick(env)).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/pull/) });
    for (const path of ['/tick', '/ensure-alarm']) expect((await worker.fetch(new Request(`https://bell.test${path}`), env)).status).toBe(409);
    let alarm = 123;
    const storage = { deleteAlarm: async () => { alarm = null; }, getAlarm: async () => alarm, setAlarm: vi.fn(), get: async () => null, put: vi.fn() };
    const state = new KeeperState({ storage }, env);
    await state.alarm();
    expect(alarm).toBeNull();
    await state.ensureAlarm();
    await state.tick();
    expect(storage.setAlarm).not.toHaveBeenCalled();
    expect(rpc.wallet).not.toHaveBeenCalled();
    expect(rpc.writes).not.toHaveBeenCalled();
  });
  it('reuses a fresh bundle across callers until its observation is consumed onchain', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const data = new Map();
    const state = new KeeperState({ storage: { get: async key => data.get(key), put: async (key, value) => data.set(key, value) }, blockConcurrencyWhile: async fn => fn() }, env);
    const routedEnv = { ...env, KEEPER_DO: { idFromName: () => 'keeper', get: () => ({ fetch: request => state.fetch(request) }) } };
    try {
      const request = () => new Request('https://bell.test/quote?symbol=AAPL');
      const first = await worker.fetch(request(), routedEnv);
      expect(first.status).toBe(200);
      const firstBundle = await first.json();
      expect(firstBundle).toMatchObject({ assetId: `0x${'1'.repeat(64)}` });
      clock.mockReturnValue(1_800_000_001_000);
      const repeated = await worker.fetch(request(), routedEnv);
      expect(repeated.status).toBe(200);
      expect(first.headers.get('cache-control')).toBe('no-store');
      expect(await repeated.json()).toEqual(firstBundle);
      rpc.direct = 1_799_999_950n;
      const consumed = await worker.fetch(request(), routedEnv);
      expect(consumed.status).toBe(409);
      expect(await consumed.json()).toMatchObject({ error: expect.stringMatching(/observation/) });
      expect(rpc.writes).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });
  it('routes quote errors as JSON and refuses non-GET quote requests', async () => {
    const response = await worker.fetch(new Request('https://bell.test/quote?symbol=MSFT'), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/symbol/) });
    expect((await worker.fetch(new Request('https://bell.test/quote?symbol=AAPL', { method: 'POST' }), env)).status).toBe(405);
  });
  it('allows browser apps to call the public quote route cross-origin', async () => {
    const preflight = await worker.fetch(new Request('https://bell.test/quote?symbol=AAPL', { method: 'OPTIONS' }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    const invalid = await worker.fetch(new Request('https://bell.test/quote?symbol=MSFT'), env);
    expect(invalid.headers.get('access-control-allow-origin')).toBe('*');
    const post = await worker.fetch(new Request('https://bell.test/quote?symbol=AAPL', { method: 'POST' }), env);
    expect(post.headers.get('access-control-allow-origin')).toBe('*');
  });
  it('serves an onchain pool directory with CORS for the static app', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: '0', result: [] }), { status: 200 })));
    try {
      const response = await worker.fetch(new Request('https://bell.test/pools', { headers: { origin: 'https://bell.exchange' } }), env);
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.json()).toEqual({ chainId: 4663, blockNumber: '100', pools: [] });
      const options = await worker.fetch(new Request('https://bell.test/pools', { method: 'OPTIONS' }), env);
      expect(options.status).toBe(204);
      expect(options.headers.get('access-control-allow-origin')).toBe('*');
      const unavailable = await worker.fetch(new Request('https://bell.test/pools'), { ...env, BELL_POOL_FACTORY: undefined });
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ error: 'Live pool discovery is temporarily unavailable' });
    } finally { vi.unstubAllGlobals(); }
  });
  it('serves wallet NFT discovery with CORS and validates the owner', async () => {
    const invalid = await worker.fetch(new Request('https://bell.test/positions?owner=bad', { headers: { origin: 'https://bell.exchange' } }), env);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('access-control-allow-origin')).toBe('*');
    expect(await invalid.json()).toEqual({ error: 'invalid owner address' });
    const options = await worker.fetch(new Request('https://bell.test/positions', { method: 'OPTIONS' }), env);
    expect(options.status).toBe(204);
  });
});
