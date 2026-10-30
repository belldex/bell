import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { decodeAbiParameters, parseAbiParameters } from 'viem';
import * as prepare from './mainnet-prepare-request.mjs';

const ZERO32 = `0x${'00'.repeat(32)}`;
const id = (byte) => `0x${byte.repeat(32)}`;
const token = (byte) => `0x${byte.repeat(20)}`;
const queue = {
  weth: { token: token('01'), descriptorId: id('01'), isStock: false },
  usdg: { token: token('02'), descriptorId: id('02'), isStock: false },
  stocks: Object.fromEntries(['AAPL', 'NVDA', 'TSLA'].map((symbol, index) => [symbol, {
    token: token(['33', '22', '11'][index]), descriptorId: id(['aa', 'bb', 'cc'][index]), isStock: true,
  }])),
};
const quote = (assetId) => ({
  assetId, directSample: {
    descriptorId: ZERO32, feedId: ZERO32, phase: '0', price18: '9007199254740993000',
    observedAt: '1000', inputAt: '1001', validFrom: '1000', expiresAt: '1301', validUntil: '1120', reportHash: id('ee'),
  }, directSignature: `0x${'ff'.repeat(65)}`, reports: ['0x1234'], closeBoundaryHash: ZERO32,
});

test('pair resolution sorts token addresses with descriptor IDs and supports every stock', () => {
  for (const symbol of ['AAPL', 'NVDA', 'TSLA']) {
    const pair = prepare.resolveOraclePair({ stock: symbol, counterasset: 'WETH', assetQueue: queue });
    assert.deepEqual(pair.stockSymbols, [symbol]);
    assert.equal(pair.asset0, id('01'));
    assert.equal(pair.asset1, queue.stocks[symbol].descriptorId);
  }
  const pair = prepare.resolveOraclePair({ stock: 'AAPL', counterasset: 'NVDA', assetQueue: queue });
  assert.deepEqual(pair.stockSymbols, ['AAPL', 'NVDA']);
  assert.equal(pair.asset0, id('bb'));
  assert.equal(pair.asset1, id('aa'));
  assert.throws(() => prepare.resolveOraclePair({ stock: 'AAPL', assetQueue: queue }), /explicit.*stock.*counterasset/i);
  assert.throws(() => prepare.resolveOraclePair({ stock: 'AAPL', counterasset: 'AAPL', assetQueue: queue }), /distinct/i);
});

test('quote HTTP flow requests exactly the selected stock legs and rejects a wrong descriptor', async (t) => {
  let wrong = false;
  const seen = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    seen.push(`${url.pathname}?${url.searchParams}`);
    const symbol = url.searchParams.get('symbol');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(quote(wrong ? id('aa') : queue.stocks[symbol].descriptorId)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const pair = prepare.resolveOraclePair({ stock: 'NVDA', counterasset: 'TSLA', assetQueue: queue });
  const quoteUrl = `http://127.0.0.1:${server.address().port}`;
  const updates = await prepare.fetchPoolOracleUpdates({ pair, quoteUrl });
  assert.deepEqual(seen.sort(), ['/quote?symbol=NVDA', '/quote?symbol=TSLA']);
  assert.deepEqual(updates.map((update) => update.assetId), [id('bb'), id('cc')]);
  assert.equal(updates[0].directSample.price18, 9007199254740993000n);
  wrong = true;
  await assert.rejects(prepare.fetchPoolOracleUpdates({ pair, quoteUrl }), /assetId.*NVDA/i);
});

test('Registry preparation uses a complete unique stock update set and canonical array encoding', () => {
  const pair = prepare.resolveOraclePair({ stock: 'AAPL', counterasset: 'NVDA', assetQueue: queue });
  const updates = [quote(id('aa')), quote(id('bb'))];
  const call = prepare.buildOraclePreparation({ pair, updates, sessionRegistry: token('77') });
  assert.equal(call.address, token('77'));
  assert.equal(call.functionName, 'applyPoolOracleUpdates');
  assert.equal(call.args[0], id('bb'));
  assert.equal(call.args[1], id('aa'));
  assert.equal(call.args[3], false);
  const abi = parseAbiParameters('(bytes32 assetId,(bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash) directSample,bytes directSignature,bytes[] reports,bytes32 closeBoundaryHash)[]');
  const [decoded] = decodeAbiParameters(abi, call.args[2]);
  assert.deepEqual(decoded.map((entry) => entry.assetId), [id('aa'), id('bb')]);
  assert.throws(() => prepare.buildOraclePreparation({ pair, updates: updates.slice(0, 1), sessionRegistry: token('77') }), /complete/i);
  assert.throws(() => prepare.buildOraclePreparation({ pair, updates: [updates[0], updates[0]], sessionRegistry: token('77') }), /duplicate/i);
});

test('Hook recovery checks the chosen pair against immutable pool config', () => {
  const pair = prepare.resolveOraclePair({ stock: 'AAPL', counterasset: 'USDG', assetQueue: queue });
  const hookConfig = { token0: token('02'), token1: token('33'), asset0: id('02'), asset1: id('aa') };
  const call = prepare.buildOraclePreparation({ pair, updates: [quote(id('aa'))], hook: token('88'), hookConfig });
  assert.equal(call.functionName, 'prepareOracleUpdates');
  assert.equal(call.address, token('88'));
  assert.equal(call.args[0][0].directSample.observedAt, 1000n);
  assert.throws(() => prepare.buildOraclePreparation({ pair, updates: [quote(id('aa'))], hook: token('88'), hookConfig: { ...hookConfig, asset1: id('bb') } }), /pool.*pair/i);
});

test('close capture requires a caller hash matching the canonical CLOSED leaf within five minutes', () => {
  const leaf = { assetId: id('aa'), year: 2026, index: 0, start: 1200n, end: 2400n, phase: 5, provenanceHash: id('dd') };
  const input = { assetId: id('aa'), leaf, chainId: 4663, calendarRegistry: token('99'), now: 1000n };
  // Independent literal from CalendarProof's deployed leaf hash domain.
  const hash = '0xecec629de3137ad6630baa26227469d6a8577a4c5b1a068ea6d2489ce8fb8f91';
  assert.equal(prepare.validateCloseBoundary({ ...input, hash }), hash);
  assert.throws(() => prepare.validateCloseBoundary({ ...input, hash, now: 899n }), /five.minute/i);
  assert.throws(() => prepare.validateCloseBoundary({ ...input, hash, now: 1200n }), /five.minute/i);
  assert.throws(() => prepare.validateCloseBoundary({ ...input, hash: id('ab') }), /canonical/i);
});

test('simulation is default and no wallet write is reachable without both explicit flags', async () => {
  const writes = [];
  const call = { address: token('77'), functionName: 'applyPoolOracleUpdates', args: [] };
  const publicClient = { simulateContract: async (request) => ({ request, result: undefined }) };
  const walletClient = { writeContract: async (request) => { writes.push(request); return id('ff'); } };
  const input = { call, publicClient, walletClient, account: token('55') };
  assert.equal((await prepare.executeOraclePreparation(input)).mode, 'PLAN_ONLY');
  assert.equal((await prepare.executeOraclePreparation({ ...input, authorized: true })).mode, 'PLAN_ONLY');
  await assert.rejects(prepare.executeOraclePreparation({ ...input, broadcast: true }), /authorize-spend/);
  assert.equal(writes.length, 0);
  const result = await prepare.executeOraclePreparation({ ...input, broadcast: true, authorized: true });
  assert.equal(result.hash, id('ff'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].functionName, 'applyPoolOracleUpdates');
});
