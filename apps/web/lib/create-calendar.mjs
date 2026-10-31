/** Select a safe preflight path; mixed stock phases cannot share one Registry update envelope. */
export function createPricePathForPhases(phases) {
  if (!Array.isArray(phases) || phases.length === 0) return 'unavailable';
  if (phases.every((phase) => phase === 5)) return 'anchor';
  if (phases.every((phase) => [1, 2, 3].includes(phase))) return 'signed-quote';
  return 'unavailable';
}
