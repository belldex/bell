const EXPECTED = Object.freeze({
  phases: { UNKNOWN: 0, PRE: 1, REGULAR: 2, POST: 3, OVERNIGHT: 4, CLOSED: 5 },
  sessionFees: { REGULAR: 500, PRE: 3000, POST: 3000, OVERNIGHT: 5000, CLOSED: 10000 },
  inputAges: { REGULAR: 60, PRE: 120, POST: 120, OVERNIGHT: 300 },
  sessionFactors: {
    REGULAR: [1, 1, 1, 1],
    PRE: [1, 2, 1, 2],
    POST: [1, 2, 1, 2],
    OVERNIGHT: [1, 4, 1, 4],
    CLOSED: [1, 5, 1, 4],
  },
  bounds: {
    maxStocksPerPool: 2,
    maxReports: 6,
    maxReportBytes: 16384,
    maxBatchBytes: 98304,
    maxSourceWiresPerAsset: 5,
    maxSourceReturnBytes: 4096,
    maxStaticCallGas: 100000,
    maxMerkleProofNodes: 32,
    governanceMinimumDelaySeconds: 172800,
    calendarPublicationLeadSeconds: 604800,
    governanceOperationExpirySeconds: 604800,
  },
});

function sameRecord(actual, expected, label) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) throw new Error(`Policy ${label} must be an object`);
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) throw new Error(`Policy ${label}.${key} must be ${value}`);
  }
  if (Object.keys(actual).length !== Object.keys(expected).length) throw new Error(`Policy ${label} has unexpected or missing fields`);
}

export function validatePolicyConfig(policy) {
  if (!policy || policy.schemaVersion !== 1 || policy.policyVersion !== 'BELL_POLICY_V1') {
    throw new Error('Policy schema/version is unsupported');
  }
  sameRecord(policy.sessions?.phase, EXPECTED.phases, 'sessions.phase');
  sameRecord(policy.fees?.session, EXPECTED.sessionFees, 'fees.session');
  if (policy.sessions.capabilityMaskValidBits?.join(',') !== '1,2,3,4') throw new Error('Policy session capability bits are invalid');

  if (policy.fees?.bell?.durationSeconds !== 300 || policy.fees.bell.rounding !== 'CEIL' || policy.fees.bell.maximumFeeUnits !== 10000
    || policy.fees.corporate?.minimumFeeUnits !== 10000 || policy.fees.corporate.durationSeconds !== 1800
    || policy.fees.repricingMinimumFeeUnits !== 10000) throw new Error('Policy fee modifiers do not match the normative brief');

  if (policy.freshness?.reportAgeSeconds !== 120
    || policy.freshness.directPriceMaximumAgeSeconds !== 600
    || policy.freshness.quoteMaximumAgeSeconds !== 600
    || policy.freshness.officialHeartbeatCapSeconds !== 600
    || policy.freshness.maximumCrossSourceDeviationBps !== 100) throw new Error('Policy freshness limits do not match the normative brief');
  sameRecord(policy.freshness.inputAgeSeconds, EXPECTED.inputAges, 'freshness.inputAgeSeconds');

  if (policy.closure?.captureWindowSeconds !== 300 || policy.closure.maximumAnchorAgeSeconds !== 96 * 60 * 60
    || policy.closure.reopenMinimumSeparationSeconds !== 60) throw new Error('Policy closure limits do not match the normative brief');
  if (policy.price?.activeBandBps !== 200 || policy.price.frozenStockBandBps !== 500
    || policy.price.normalizedPriceDecimals !== 18 || policy.price.maximumTokenDecimals !== 18
    || policy.price.comparisonWidthBits !== 768) throw new Error('Policy price limits do not match the normative brief');

  if (policy.budgets?.rollingWindowSeconds !== 300 || policy.budgets.maximumClosureTimesTradeCap !== 2
    || policy.budgets.maximumClosureSeedFractionDenominator !== 10) throw new Error('Policy budget limits do not match the normative brief');
  for (const [session, factors] of Object.entries(EXPECTED.sessionFactors)) {
    const actual = policy.budgets.sessionFactors?.[session];
    const expected = {
      tradeNumerator: factors[0], tradeDenominator: factors[1],
      windowNumerator: factors[2], windowDenominator: factors[3],
    };
    sameRecord(actual, expected, `budgets.sessionFactors.${session}`);
  }
  sameRecord(policy.budgets.guardMinimum, {
    tradeNumerator: 1, tradeDenominator: 5, windowNumerator: 1, windowDenominator: 4,
  }, 'budgets.guardMinimum');
  if (Object.keys(policy.budgets.sessionFactors ?? {}).length !== 5) throw new Error('Policy session factors are incomplete');

  sameRecord(policy.bounds, EXPECTED.bounds, 'bounds');
  if (policy.transactions?.quoteExpiryMaximumSeconds !== 30 || policy.transactions.deadlineMaximumSeconds !== 120) {
    throw new Error('Policy transaction expiries do not match the normative brief');
  }
  return true;
}
