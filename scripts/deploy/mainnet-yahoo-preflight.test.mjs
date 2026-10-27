import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./mainnet-yahoo-preflight.mjs', import.meta.url), 'utf8');

test('mainnet preflight refuses to invent an adapter address', () => {
  // A placeholder address would let the script walk into getBytecode and fail with a generic
  // "adapter not deployed" error after spending mainnet RPC reads. Every scope must start null.
  assert.doesNotMatch(source, /0x0{36}[abc]00[1-4]/i, 'no placeholder adapter addresses');
  for (const symbol of ['AAPL', 'NVDA', 'TSLA']) {
    assert.match(
      source,
      new RegExp(`${symbol}: \\{ direct: null, regular: null, extended: null, overnight: null \\}`),
      `${symbol} adapters must be unset until actually deployed`,
    );
  }
});

test('mainnet preflight reports a missing adapter as its own status instead of a generic failure', () => {
  assert.match(source, /ADAPTER_NOT_DEPLOYED/);
  assert.match(source, /No placeholder address is accepted/);
  // It must bail before calling into the signing/preflight helper.
  const guardIndex = source.indexOf('ADAPTER_NOT_DEPLOYED');
  const callIndex = source.indexOf('preflightYahooMainnet({');
  assert.ok(guardIndex > 0 && callIndex > guardIndex, 'adapter guard must run before the preflight call');
});

test('mainnet preflight accepts a real adapter from env and rejects an out-of-range scope', () => {
  assert.match(source, /YAHOO_\$\{symbol\}_SCOPE_\$\{phaseScope\}_ADAPTER/);
  assert.match(source, /--scope must be 0, 1, 2 or 3/);
});
