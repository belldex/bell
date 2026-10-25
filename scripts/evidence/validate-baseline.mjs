const gateIds = ['E01', 'E02', 'E03', 'E04', 'E05', 'E06'];
const requiredFundingGates = gateIds.slice(0, 5);
const allowedGateStatuses = new Set([
  'NOT_RUN',
  'MISSING',
  'BLOCKED_ACCESS',
  'BLOCKED_DEPENDENCY',
  'PASS',
]);

function hasEvidenceReference(value) {
  return (typeof value === 'string' && value.trim().length > 0)
    || (Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0));
}

export function validateBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    throw new TypeError('Baseline must be an object');
  }
  if (!/^[a-f0-9]{64}$/i.test(baseline.briefSha256 ?? '')) {
    throw new Error('Baseline briefSha256 must be a SHA-256 hex digest');
  }
  if (!/^[a-f0-9]{64}$/i.test(baseline.implementationPlanSha256 ?? '')) {
    throw new Error('Baseline implementationPlanSha256 must be a SHA-256 hex digest');
  }

  const expectedScope = { milestones: 16, tasks: 80, gaps: 40, decisions: 12, releaseGates: 6 };
  for (const [key, expected] of Object.entries(expectedScope)) {
    if (baseline.scope?.[key] !== expected) {
      throw new Error(`Baseline scope.${key} must remain ${expected}`);
    }
  }

  if (!baseline.gates || typeof baseline.gates !== 'object' || Array.isArray(baseline.gates)) {
    throw new Error('Baseline gates must contain E01-E06 statuses');
  }
  for (const id of gateIds) {
    const status = baseline.gates[id];
    if (!allowedGateStatuses.has(status)) {
      throw new Error(`Baseline gate ${id} has an invalid status`);
    }
    if (status === 'PASS' && !hasEvidenceReference(baseline.evidenceByGate?.[id])) {
      throw new Error(`Baseline gate ${id} cannot PASS without an evidence reference`);
    }
  }

  if (baseline.mainnetFundingAllowed === true && !requiredFundingGates.every((id) => baseline.gates[id] === 'PASS')) {
    throw new Error('Mainnet funding is blocked until E01-E05 PASS');
  }
  if (baseline.publicReleaseAllowed === true && !gateIds.every((id) => baseline.gates[id] === 'PASS')) {
    throw new Error('Public release is blocked until E01-E06 PASS');
  }
  return true;
}
