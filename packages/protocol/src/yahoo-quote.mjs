const TICKER_RE = /^[A-Z][A-Z0-9.^=-]{0,15}$/;
const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_MAX_AGE_SECONDS = 600;

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
} = {}) {
  const ticker = checkedTicker(symbol);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is unavailable');
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set('interval', '1m');
  url.searchParams.set('range', '1d');
  // Without this flag Yahoo only returns regular-session candles, so premarket/after-hours
  // sessions would look permanently stale outside 09:30–16:00 ET even when quotes are live.
  url.searchParams.set('includePrePost', 'true');

  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000), redirect: 'error' });
  } catch {
    throw new Error('Yahoo chart request failed or timed out');
  }
  if (!response.ok) throw new Error(`Yahoo chart returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('Yahoo chart response exceeded 512 KiB');
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('Yahoo chart returned invalid JSON'); }
  return parseYahooChartQuote(payload, { symbol: ticker, currency, nowSeconds, maxAgeSeconds });
}
