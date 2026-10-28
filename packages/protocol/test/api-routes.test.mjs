import test from 'node:test';
import assert from 'node:assert/strict';
import { readAssets, readPolicy, readTransaction } from '../src/api-reads.mjs';
import { validateQuoteRequest, quoteResponse, isPolicyBlock } from '../src/api-quote.mjs';
import { validateCreateRequest, createPreview } from '../src/api-create.mjs';

const H = (n) => '0x' + n.toString(16).padStart(64, '0');
const provenance = { observedBlockNumber: 100, observedBlockHash: H(1), observedAt: 1000 };

test('assets pagination is deterministic with cursor and bounded limit', () => {
  const assets = [
    { descriptorId: 'zz', tokenAddress: '0xaa', admitted: true, class: 'PRICE_GUARDED', capabilities: {} },
    { descriptorId: 'aa', tokenAddress: '0xbb', admitted: false, class: 'SESSION_ONLY', capabilities: {} },
  ];
  const page = readAssets({ chainId: 1, assets, limit: 1, ...provenance });
  assert.equal(page.assets.length, 1);
  assert.equal(page.assets[0].descriptorId, 'aa');
  assert.equal(page.nextCursor, 'aa');
  const next = readAssets({ chainId: 1, assets, limit: 1, cursor: 'aa', ...provenance });
  assert.equal(next.assets[0].descriptorId, 'zz');
  assert.equal(next.nextCursor, null);
});

test('unknown pool is 404, never an empty healthy policy', () => {
  const miss = readPolicy({ chainId: 1, poolId: 'p1', onchainPolicy: null, ...provenance });
  assert.equal(miss.http, 404);
  const hit = readPolicy({ chainId: 1, poolId: 'p1', ...provenance, requestId: 'r1',
    onchainPolicy: { configHash: H(2), class: 'PRICE_GUARDED', lifecycle: 'OPEN', referenceMode: 'BAND', effectiveLpFee: 500, reasons: [], budgets: {}, canSwap: true } });
  assert.equal(hit.canSwap, true);
  assert.match(hit.disclaimer, /not an amount guarantee/);
});

test('transaction reads carry pending through finalized and reorg states', () => {
  const hit = readTransaction({ chainId: 1, txHash: H(3), indexed: { state: 'CONFIRMED_UNFINALIZED', ...provenance, reorgState: 'NONE' } });
  assert.equal(hit.state, 'CONFIRMED_UNFINALIZED');
  const miss = readTransaction({ chainId: 1, txHash: H(3), indexed: null });
  assert.equal(miss.http, 404);
});

test('quote requests: exact-in or exact-out, never both or neither', () => {
  const base = { direction: 'EXACT_IN', recipient: '0x' + 'cd'.repeat(20), slippageRaw: '500', quoteExpirySeconds: 30, deadlineSeconds: 120, configHash: H(4) };
  assert.throws(() => validateQuoteRequest(base), /exactly one/);
  assert.throws(() => validateQuoteRequest({ ...base, amountIn: '1', amountOut: '2' }), /exactly one/);
  assert.throws(() => validateQuoteRequest({ ...base, amountIn: '1.5' }), /decimal/);
  assert.throws(() => validateQuoteRequest({ ...base, amountIn: '1', slippageRaw: '-1' }), /slippage/);
  assert.throws(() => validateQuoteRequest({ ...base, amountIn: '1', quoteExpirySeconds: 31 }), /1\.\.30/);
  const ok = validateQuoteRequest({ ...base, amountIn: '1000' });
  assert.equal(ok.amountOut, null);
});

test('a valid policy halt is typed canExecute=false, not a 503', () => {
  const blocked = quoteResponse({ chainId: 1, ...provenance,
    request: { direction: 'EXACT_IN', amountIn: '1', amountOut: null, recipient: '0x' + 'cd'.repeat(20), slippageRaw: '500', configHash: H(4) },
    simulation: { canExecute: false, reasons: ['HALTED_SESSION_UNKNOWN'], revertReason: 'BELL_HALTED' },
    quoteExpirySeconds: 30 });
  assert.equal(blocked.canExecute, false);
  assert.deepEqual(blocked.reasons, ['HALTED_SESSION_UNKNOWN']);
  assert.equal(isPolicyBlock({ canExecute: false, reasons: ['X'] }), true);
  assert.equal(isPolicyBlock({ canExecute: false }), false);
});

test('quote binds the observed block and config hash it was simulated against', () => {
  const ok = quoteResponse({ chainId: 1, ...provenance,
    request: { direction: 'EXACT_IN', amountIn: '1', amountOut: null, recipient: '0x' + 'cd'.repeat(20), slippageRaw: '500', configHash: H(4) },
    simulation: { canExecute: true, calldataCandidate: '0xabc' }, quoteExpirySeconds: 30 });
  assert.equal(ok.quote.expectedObservedBlockNumber, 100);
  assert.equal(ok.quote.configHash, H(4));
  assert.equal(ok.quote.quoteExpirySeconds, 30);
});

test('create requests validate assets, class and amounts', () => {
  const req = { chainId: 1, baseAsset: '0x' + 'aa'.repeat(20), quoteAsset: '0x' + 'bb'.repeat(20), class: 'PRICE_GUARDED', initialPriceRaw: '1', seedMaxRaw: '10' };
  assert.throws(() => validateCreateRequest({ ...req, class: 'NOPE' }), /PRICE_GUARDED/);
  assert.throws(() => validateCreateRequest({ ...req, quoteAsset: req.baseAsset }), /must differ/);
  assert.throws(() => validateCreateRequest({ ...req, initialPriceRaw: '1e18' }), /decimal/);
  assert.equal(validateCreateRequest(req).class, 'PRICE_GUARDED');
});

test('unknown token produces INTAKE_NEEDED, not a deployable preview', () => {
  const registry = {
    hasDescriptor: () => false,
    capabilities: () => ({}),
    predictedHook: () => '0x1', predictedPoolId: () => '0x2',
    requestHashFor: () => H(5), configHashFor: () => H(6),
  };
  const res = createPreview({ chainId: 1, ...provenance,
    request: { baseAsset: '0x' + 'aa'.repeat(20), quoteAsset: '0x' + 'bb'.repeat(20), class: 'SESSION_ONLY', initialPriceRaw: '1', seedMaxRaw: '10', capsRaw: {} },
    registry });
  assert.equal(res.status, 'INTAKE_NEEDED');
  assert.equal(res.preview, null);
  assert.equal(res.intake.unknownAssets.length, 2);
  assert.match(res.intake.message, /not registered/i);
});

test('SESSION_ONLY without a canonical stock is not admitted', () => {
  const registry = {
    hasDescriptor: () => true,
    capabilities: () => ({ independentPriceSource: false, canonicalStock: false }),
    predictedHook: () => '0x1', predictedPoolId: () => '0x2',
    requestHashFor: () => H(5), configHashFor: () => H(6),
  };
  const res = createPreview({ chainId: 1, ...provenance,
    request: { baseAsset: '0x' + 'aa'.repeat(20), quoteAsset: '0x' + 'bb'.repeat(20), class: 'SESSION_ONLY', initialPriceRaw: '1', seedMaxRaw: '10', capsRaw: {} },
    registry });
  assert.equal(res.status, 'NOT_ADMITTED');
  assert.match(res.reason, /canonical stock asset is required/i);
});

test('eligible preview exposes predicted identity, fee and disclosures', () => {
  const registry = {
    hasDescriptor: () => true,
    capabilities: (a) => a === '0x' + 'aa'.repeat(20) ? { canonicalStock: true } : { independentPriceSource: true },
    predictedHook: () => '0x1', predictedPoolId: () => '0x2',
    requestHashFor: () => H(5), configHashFor: () => H(6),
  };
  const res = createPreview({ chainId: 1, ...provenance,
    request: { baseAsset: '0x' + 'aa'.repeat(20), quoteAsset: '0x' + 'bb'.repeat(20), class: 'SESSION_ONLY', initialPriceRaw: '1', seedMaxRaw: '10', capsRaw: {} },
    registry });
  assert.equal(res.status, 'OK');
  assert.equal(res.preview.predictedHookAddress, '0x1');
  assert.equal(res.preview.serviceFeeUsdg, '49000000');
  assert.ok(res.preview.disclosures[0].includes('SESSION_ONLY'));
  assert.match(res.preview.disclosures[0], /does not guarantee a fair price/i);
});
