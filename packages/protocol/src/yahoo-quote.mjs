const TICKER_RE = /^[A-Z][A-Z0-9.^=-]{0,15}$/;
const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_MAX_AGE_SECONDS = 600;
export const YAHOO_REQUEST_TIMEOUT_MS = 10_000;

function checkedTicker(symbol) {
  if (typeof symbol !== 'string' || !TICKER_RE.test(symbol)) {
    throw new TypeError('Yahoo ticker must use 1-16 uppercase ticker characters');
  }
  return symbol;
}

function scaled18(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new TypeError('Yahoo close must be numeric');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('Yahoo close must be finite');
  const text = String(value);
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new TypeError('Yahoo close is not a decimal number');
  if (match[1] === '-') throw new RangeError('Yahoo close must be positive');
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) throw new RangeError('Yahoo close exponent is out of range');
  let digits = `${match[2]}${fraction}`.replace(/^0+(?=\d)/, '');
  let decimalPlaces = fraction.length - exponent;
  if (decimalPlaces < 0) {
    digits += '0'.repeat(-decimalPlaces);
    decimalPlaces = 0;
  }
  if (decimalPlaces > 18) {
    const discarded = digits.slice(digits.length - (decimalPlaces - 18));
    if (/[1-9]/.test(discarded)) throw new RangeError('Yahoo close has more than 18 significant decimal places');
    digits = digits.slice(0, digits.length - (decimalPlaces - 18));
    decimalPlaces = 18;
  }
  const price = BigInt(digits || '0') * 10n ** BigInt(18 - decimalPlaces);
  if (price <= 0n || price > (1n << 128n) - 1n) throw new RangeError('Yahoo close is outside uint128 1e18 price domain');
  return price;
}

function tradingPhase(periods, nowSeconds) {
  if (!periods || typeof periods !== 'object') return 'UNKNOWN';
  for (const [key, phase] of [['pre', 'PRE'], ['regular', 'REGULAR'], ['post', 'POST']]) {
    const range = periods[key];
    if (range && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end)
      && nowSeconds >= range.start && nowSeconds < range.end) return phase;
  }
  return 'CLOSED';
}

/**
 * Parse a Yahoo Finance chart response into a freshness-checked BELL price observation.
 * This is real offchain market data, not a Yahoo-signed/Chainlink report; an onchain adapter
 * must independently authenticate the BELL reporter that attests this observation.
 */
export function parseYahooChartQuote(payload, {
  symbol,
  currency = 'USD',
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
} = {}) {
  const ticker = checkedTicker(symbol);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new RangeError('nowSeconds must be a non-negative safe integer');
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 600) {
    throw new RangeError('maxAgeSeconds must be between 1 and 600 seconds');
  }
  const result = payload?.chart?.result?.[0];
  if (!result || payload?.chart?.error) throw new Error('Yahoo chart response has no result');
  const meta = result.meta;
  if (typeof meta?.symbol !== 'string' || meta.symbol.toUpperCase() !== ticker) throw new Error('Yahoo symbol mismatch');
  if (meta.currency !== currency) throw new Error('Yahoo currency mismatch');

  const timestamps = result.timestamp;
  const closes = result.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length) {
    throw new Error('Yahoo chart timestamps and closes are malformed');
  }
  let latest = null;
  let hasFuture = false;
  for (let i = 0; i < timestamps.length; i += 1) {
    const timestamp = timestamps[i];
    const close = closes[i];
    if (!Number.isSafeInteger(timestamp) || close === null || close === undefined) continue;
    let priceRaw18;
    try { priceRaw18 = scaled18(close); } catch { continue; }
    if (timestamp > nowSeconds) {
      hasFuture = true;
      continue;
    }
    if (!latest || timestamp > latest.observedAt) latest = { observedAt: timestamp, priceRaw18 };
  }
  if (!latest) {
    if (hasFuture) throw new Error('Yahoo chart only contains future observations');
    throw new Error('Yahoo chart has no valid close');
  }
  const ageSeconds = nowSeconds - latest.observedAt;
  if (ageSeconds > maxAgeSeconds) throw new Error(`Yahoo quote is stale (${ageSeconds}s old)`);

  return Object.freeze({
    symbol: ticker,
    currency,
    priceRaw18: latest.priceRaw18.toString(),
    observedAt: latest.observedAt,
    inputAt: latest.observedAt,
    ageSeconds,
    phase: tradingPhase(meta.currentTradingPeriod, nowSeconds),
    source: 'YAHOO_CHART_API',
    sourceSigned: false,
  });
}

export async function fetchYahooChartQuote(symbol, {
  fetchImpl = globalThis.fetch,
  currency = 'USD',
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  // Cloudflare's outbound network cannot reach Yahoo's chart hosts directly in this deployment.
  // Google Translate's web proxy relays the same Yahoo JSON; callers still validate the symbol,
  // currency, observation timestamp, phase, and freshness below.
  preferProxy = typeof WebSocketPair !== 'undefined',
} = {}) {
  const ticker = checkedTicker(symbol);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is unavailable');
  let response;
  let lastError;
  let lastHost;
  if (preferProxy) {
    const upstream = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
    upstream.searchParams.set('interval', '1m');
    upstream.searchParams.set('range', '1d');
    upstream.searchParams.set('includePrePost', 'true');
    const translatedHost = `${upstream.hostname.replaceAll('.', '-')}.translate.goog`;
    const proxy = new URL(`https://${translatedHost}${upstream.pathname}${upstream.search}`);
    proxy.searchParams.set('_x_tr_sl', 'auto');
    proxy.searchParams.set('_x_tr_tl', 'en');
    proxy.searchParams.set('_x_tr_hl', 'en');
    proxy.searchParams.set('_x_tr_pto', 'wapp');
    try {
      response = await fetchImpl(proxy, {
        headers: { accept: 'application/json', 'user-agent': 'BELLQuote/1.0' },
        signal: AbortSignal.timeout(YAHOO_REQUEST_TIMEOUT_MS), redirect: 'follow',
      });
      if (!response.ok) throw new Error(`Yahoo translated relay returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      // Jina Reader is a second relay option; its wrapper content is checked to ensure its final
      // target remains the exact Yahoo chart host and ticker.
      try {
        const relayUrl = `https://r.jina.ai/http://${upstream.host}${upstream.pathname}${upstream.search}`;
        const relayed = await fetchImpl(relayUrl, {
          headers: { accept: 'application/json', 'user-agent': 'BELLQuote/1.0' },
          signal: AbortSignal.timeout(YAHOO_REQUEST_TIMEOUT_MS), redirect: 'follow',
        });
        if (!relayed.ok) throw new Error(`Yahoo Reader relay returned HTTP ${relayed.status}`);
        const bytes = new Uint8Array(await relayed.arrayBuffer());
        if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('Yahoo relay response exceeded 512 KiB');
        const envelope = JSON.parse(new TextDecoder().decode(bytes));
        const finalUrl = new URL(envelope?.data?.finalUrl ?? 'https://invalid/');
        if (finalUrl.hostname !== 'query1.finance.yahoo.com'
          || !finalUrl.pathname.startsWith(`/v8/finance/chart/${ticker}`)
          || envelope?.data?.httpStatus !== 200 || typeof envelope?.data?.content !== 'string') {
          throw new Error('Yahoo relay returned an untrusted or unsuccessful response');
        }
        response = new Response(envelope.data.content, { status: 200, headers: { 'content-type': 'application/json' } });
      } catch (relayError) {
        throw new Error(`Yahoo chart relays failed: ${String(lastError?.message ?? lastError).slice(0, 80)}; ${String(relayError?.message ?? relayError).slice(0, 80)}`);
      }
    }
  }
  if (preferProxy) {
    // Skip direct hosts in Workers: their known network timeout consumes the isolate's request budget.
  } else {
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}`);
    url.searchParams.set('interval', '1m');
    url.searchParams.set('range', '1d');
    // Without this flag Yahoo only returns regular-session candles, so premarket/after-hours
    // sessions would look permanently stale outside 09:30–16:00 ET even when quotes are live.
    url.searchParams.set('includePrePost', 'true');
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; BELLQuote/1.0)' },
        signal: AbortSignal.timeout(YAHOO_REQUEST_TIMEOUT_MS), redirect: 'error',
      });
      if (response.ok) break;
      lastError = new Error(`Yahoo chart returned HTTP ${response.status}`);
      lastHost = host;
    } catch (error) {
      lastError = error;
      lastHost = host;
    }
  }
  if (!response?.ok) {
    if (lastError?.message?.startsWith('Yahoo chart returned HTTP')) throw lastError;
    throw new Error(`Yahoo chart request failed or timed out at ${lastHost ?? 'both endpoints'}`);
  }
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('Yahoo chart response exceeded 512 KiB');
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('Yahoo chart returned invalid JSON'); }
  return parseYahooChartQuote(payload, { symbol: ticker, currency, nowSeconds, maxAgeSeconds });
}
