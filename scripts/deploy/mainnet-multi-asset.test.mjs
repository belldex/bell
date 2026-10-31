import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const candidates = JSON.parse(readFileSync('config/assets/candidates.mainnet.json', 'utf8'));
const yahooRunner = readFileSync('scripts/deploy/mainnet-yahoo-stack.mjs', 'utf8');
const admitRunner = readFileSync('scripts/deploy/mainnet-admit-assets.mjs', 'utf8');

test('candidate list is the full documented mainnet set', () => {
  const symbols = candidates.assets.map((a) => a.symbol);
  assert.deepEqual(symbols, ['AAPL', 'NVDA', 'TSLA']);
  for (const asset of candidates.assets) {
    assert.equal(asset.admitted, false, `${asset.symbol} must not be pre-marked admitted`);
    assert.match(asset.token, /^0x[0-9a-fA-F]{40}$/);
    assert.match(asset.directAdjustedTokenUsd.proxy, /^0x[0-9a-fA-F]{40}$/);
  }
});

test('yahoo stack runner iterates every candidate instead of one BELL_MAINNET_SYMBOL', () => {
  assert.match(yahooRunner, /candidates\.assets/);
  assert.match(yahooRunner, /deployYahooStackForSymbol|for\s*\(\s*const asset|assets\.map|BELL_MAINNET_ASSETS/);
});

test('admission runner admits every candidate stock, not a single configured symbol', () => {
  // `configured.assets` is the candidate list source; `adapters.assets` is the deployed per-symbol map.
  assert.match(admitRunner, /configured\.assets\.map|candidates\.assets/);
  assert.match(admitRunner, /adapters\.assets\[/);
  // Capability mask must include PRE|REGULAR|POST|OVERNIGHT (0b11110) for the deployed scope.
  assert.match(admitRunner, /0b11110|30\b/, 'capability mask must cover all four equity sessions');
});

test('brief decision removed the four-weekend gate so runners must not wait for it', () => {
  const brief = readFileSync('docs/BELL-Developer-Brief-Final.md', 'utf8');
  assert.match(brief, /Decision 2026-10-29: the four-weekend availability gate is removed/);
});
