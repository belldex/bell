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
