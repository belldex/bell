/** Resolve deployment-specific keeper settings without silently targeting an old stack. */
export function resolveSessionRegistry(env, manifest) {
  const address = env.BELL_SESSION_REGISTRY || manifest?.sessionRegistry;
  if (!address) throw new Error('SessionRegistry is missing from both BELL_SESSION_REGISTRY and deployment manifest');
  return address;
}

export function shouldContinueAfterTickError(error) {
  return error?.code === 'STALE_SOURCE';
}

export function price18FromYahooQuote(quote) {
  return BigInt(quote.priceRaw18);
}

export function reportValidUntil(now, observedAt) {
  const validUntil = Math.min(now + 119, observedAt + 119);
  if (validUntil <= now) throw new Error('Yahoo report has no remaining validity');
  return validUntil;
}

export function yahooRegularPhaseReady(quote) {
  return quote?.phase === 'REGULAR';
}

export function yahooSessionPhase(phase) {
  return phase === 'REGULAR' ? 2 : phase === 'PRE' ? 1 : phase === 'POST' ? 3 : null;
}

export function yahooWireScopeForCalendarPhase(phase) {
  return phase === 2 ? 1 : phase === 1 || phase === 3 ? 2 : phase === 4 ? 3 : null;
}

export function isNewYahooQuote(quote, expectedPhase, latestObservedAt, maxAgeSeconds = 120) {
  return quote?.phase === expectedPhase && Number.isSafeInteger(quote.observedAt)
    && Number.isSafeInteger(quote.ageSeconds) && quote.ageSeconds >= 0 && quote.ageSeconds < maxAgeSeconds
    && quote.observedAt > latestObservedAt;
}

export function transactionGas(value) {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) throw new TypeError('gas must be a positive integer');
  return BigInt(value);
}

export function isPoolCreatePreflightReady(health, now) {
  return health?.ready === true && health.reasonBits === 0n && health.validUntil > BigInt(now);
}

export function amountMaxForTokens(token0, token1, weth, wethMax, stockMax) {
  const a = token0.toLowerCase();
  const b = token1.toLowerCase();
  const w = weth.toLowerCase();
  if (a === b || (a !== w && b !== w)) throw new Error('Pool must contain WETH exactly once');
  return a === w ? [wethMax, stockMax] : [stockMax, wethMax];
}

export function yahooWireForCalendarPhase(adapters, phase) {
  const scope = yahooWireScopeForCalendarPhase(phase);
  if (scope === 1) return { wire: adapters.regularWire, wireHash: adapters.regularWireHash };
  if (scope === 2) return { wire: adapters.extendedWire, wireHash: adapters.extendedWireHash };
  if (scope === 3) return { wire: adapters.overnightWire, wireHash: adapters.overnightWireHash };
  return null;
}
