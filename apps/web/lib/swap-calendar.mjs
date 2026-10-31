/** Return the price path the router expects for the policy phase shown by the pool. */
export function quoteSourceForPhase(phase) {
  if (phase === 5) return 'anchor';
  if ([1, 2, 3, 4].includes(phase)) return 'chainlink-feed';
  return 'unavailable';
}

/** Product copy for the compact onchain phase indicator. */
export function phaseLabel(phase) {
  return ({ 0: 'Unknown', 1: 'Pre-market', 2: 'Regular', 3: 'Post-market', 4: 'Overnight', 5: 'Weekend reference' })[phase] ?? 'Unknown';
}
