import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchYahooChartQuote, parseYahooChartQuote, YAHOO_REQUEST_TIMEOUT_MS } from '../src/yahoo-quote.mjs';

function chartFixture(overrides = {}) {
  return {
    chart: {
      error: null,
      result: [{
        meta: {
          symbol: 'AAPL',
          currency: 'USD',
          currentTradingPeriod: {
            pre: { start: 1000, end: 2000 },
            regular: { start: 2000, end: 3000 },
            post: { start: 3000, end: 4000 },
          },
        },
        timestamp: [2500, 2560],
        indicators: { quote: [{ close: [342.90, 343.14] }] },
        ...overrides,
      }],
    },
  };
}

test('parses the latest real Yahoo candle as exact 1e18-scaled price', () => {
  const quote = parseYahooChartQuote(chartFixture(), { symbol: 'AAPL', nowSeconds: 2600, maxAgeSeconds: 600 });
  assert.equal(quote.symbol, 'AAPL');
  assert.equal(quote.currency, 'USD');
  assert.equal(quote.priceRaw18, '343140000000000000000');
  assert.equal(quote.observedAt, 2560);
  assert.equal(quote.phase, 'REGULAR');
});

test('rejects wrong symbol, quote currency, stale point, and future timestamps', () => {
  assert.throws(() => parseYahooChartQuote(chartFixture(), { symbol: 'TSLA', nowSeconds: 2600 }), /symbol mismatch/i);
  const wrongCurrency = chartFixture();
  wrongCurrency.chart.result[0].meta.currency = 'EUR';
  assert.throws(() => parseYahooChartQuote(wrongCurrency, { symbol: 'AAPL', nowSeconds: 2600 }), /currency mismatch/i);
  assert.throws(() => parseYahooChartQuote(chartFixture(), { symbol: 'AAPL', nowSeconds: 4000, maxAgeSeconds: 600 }), /stale/i);
  const futureOnly = chartFixture();
  futureOnly.chart.result[0].timestamp = [2560, 2570];
  assert.throws(() => parseYahooChartQuote(futureOnly, { symbol: 'AAPL', nowSeconds: 2550 }), /future/i);
});

test('rejects non-finite or missing close values instead of reusing last good data', () => {
  const missingClose = chartFixture();
  missingClose.chart.result[0].indicators.quote[0].close = [null, null];
  assert.throws(() => parseYahooChartQuote(missingClose, { symbol: 'AAPL', nowSeconds: 2600 }), /no valid close/i);
});

test('maps premarket and postmarket intervals without calling them regular session', () => {
  const preInput = chartFixture();
  preInput.chart.result[0].timestamp = [1400, 1460];
  const pre = parseYahooChartQuote(preInput, { symbol: 'AAPL', nowSeconds: 1500, maxAgeSeconds: 600 });
  assert.equal(pre.phase, 'PRE');
  const postInput = chartFixture();
  postInput.chart.result[0].timestamp = [3200, 3360];
  const post = parseYahooChartQuote(postInput, { symbol: 'AAPL', nowSeconds: 3500, maxAgeSeconds: 600 });
  assert.equal(post.phase, 'POST');
});

test('fetches the public Yahoo chart endpoint without an API key and parses its real response', async () => {
  assert.equal(YAHOO_REQUEST_TIMEOUT_MS, 10_000);
  let requestedUrl;
  const response = new Response(JSON.stringify(chartFixture()), { status: 200 });
  const quote = await fetchYahooChartQuote('AAPL', {
    fetchImpl: async (url) => { requestedUrl = new URL(url); return response; },
    nowSeconds: 2600,
  });
  assert.equal(requestedUrl.hostname, 'query1.finance.yahoo.com');
  assert.equal(requestedUrl.searchParams.get('interval'), '1m');
  assert.equal(requestedUrl.searchParams.get('range'), '1d');
  assert.equal(quote.priceRaw18, '343140000000000000000');
  assert.equal(quote.sourceSigned, false);
});

test('falls back to Yahoo query2 when query1 transport fails', async () => {
  const hosts = [];
  const quote = await fetchYahooChartQuote('AAPL', {
    fetchImpl: async (url) => {
      hosts.push(new URL(url).hostname);
      if (hosts.length === 1) throw new Error('network unavailable');
      return new Response(JSON.stringify(chartFixture()), { status: 200 });
    },
    nowSeconds: 2600,
  });
  assert.deepEqual(hosts, ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']);
  assert.equal(quote.priceRaw18, '343140000000000000000');
});

test('uses Yahoo through the Cloudflare reachable Translate relay and validates returned quote data', async () => {
  let requestedUrl;
  const quote = await fetchYahooChartQuote('AAPL', {
    preferProxy: true,
    fetchImpl: async (url) => { requestedUrl = new URL(url); return new Response(JSON.stringify(chartFixture())); },
    nowSeconds: 2600,
  });
  assert.equal(requestedUrl.hostname, 'query1-finance-yahoo-com.translate.goog');
  assert.equal(requestedUrl.searchParams.get('_x_tr_tl'), 'en');
  assert.equal(quote.priceRaw18, '343140000000000000000');
});

test('falls back to Yahoo Reader relay only when Translate relay is unavailable', async () => {
  const hosts = [];
  const envelope = { data: {
    finalUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1m&includePrePost=true',
    httpStatus: 200, content: JSON.stringify(chartFixture()),
  } };
  const quote = await fetchYahooChartQuote('AAPL', {
    preferProxy: true,
    fetchImpl: async (url) => {
      hosts.push(new URL(url).hostname);
      if (hosts.length === 1) return new Response('', { status: 429 });
      return new Response(JSON.stringify(envelope));
    },
    nowSeconds: 2600,
  });
  assert.deepEqual(hosts, ['query1-finance-yahoo-com.translate.goog', 'r.jina.ai']);
  assert.equal(quote.priceRaw18, '343140000000000000000');
});

test('rejects a mismatched Yahoo Reader relay target', async () => {
  await assert.rejects(() => fetchYahooChartQuote('AAPL', {
    preferProxy: true,
    fetchImpl: async (url) => new URL(url).hostname.endsWith('.translate.goog')
      ? new Response('', { status: 429 })
      : new Response(JSON.stringify({ data: { finalUrl: 'https://evil.example/v8/finance/chart/AAPL', httpStatus: 200, content: JSON.stringify(chartFixture()) } })),
    nowSeconds: 2600,
  }), /untrusted/);
});

test('surfaces provider HTTP errors instead of fabricating a quote', async () => {
  await assert.rejects(
    () => fetchYahooChartQuote('AAPL', { fetchImpl: async () => new Response('', { status: 429 }), nowSeconds: 2600 }),
    /HTTP 429/
  );
});
