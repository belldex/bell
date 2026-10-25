const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const PHASES = ['REGULAR', 'EXTENDED', 'OVERNIGHT'];
const REQUIRED_ADMISSION_EVIDENCE = [
  'authenticatedCommonBlockReads',
  'rightsMatrix',
  'calendarCoverage',
  'testnetVerificationSubmission',
  'freshnessSuitability',
];

function recordErrors(errors, predicate, message) {
  if (!predicate) errors.push(message);
}

export function inspectCandidateManifest(manifest) {
  const errors = [];
  recordErrors(errors, manifest?.schemaVersion === 1, 'unsupported manifest schema');
  recordErrors(errors, manifest?.network?.chainId === 4663, 'candidate must explicitly target mainnet chain 4663');
  recordErrors(errors, manifest?.status === 'DOCUMENTED_CANDIDATES_NOT_ADMITTED', 'documented snapshot must not be labelled admitted');
  recordErrors(errors, SHA256.test(manifest?.snapshot?.discoverySha256 ?? ''), 'invalid Discovery snapshot SHA-256');
  recordErrors(errors, SHA256.test(manifest?.snapshot?.assetsSha256 ?? ''), 'invalid assets snapshot SHA-256');
  recordErrors(errors, ADDRESS.test(manifest?.verifier?.address ?? ''), 'invalid verifier address');
  if (manifest?.verifier?.verifiedOnchain === true && !BYTES32.test(manifest.verifier.codeHash ?? '')) {
    errors.push('verified verifier requires an onchain code hash');
  }
  for (const quote of ['ETH_USD', 'USDG_USD']) {
    const source = manifest?.quoteFeeds?.[quote];
    if (!ADDRESS.test(source?.proxy ?? '') || source?.decimals !== 8
      || !Number.isSafeInteger(source?.heartbeatSeconds) || source.heartbeatSeconds <= 0) {
      errors.push(`${quote} quote-feed metadata is invalid`);
    }
    if (source?.verifiedOnchain === true && !BYTES32.test(source.codeHash ?? '')) {
      errors.push(`${quote} verified proxy requires an onchain code hash`);
    }
  }

  const usedFeedIds = new Set();
  const usedTokens = new Set();
  const candidates = [];
  const admitted = [];
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  recordErrors(errors, assets.length > 0 && assets.length <= 6, 'asset candidate count is outside the bounded envelope');

  for (const asset of assets) {
    const assetErrors = [];
    const symbol = typeof asset?.symbol === 'string' ? asset.symbol : 'UNKNOWN';
    if (!ADDRESS.test(asset?.token ?? '')) assetErrors.push('canonical token address is invalid');
    else if (usedTokens.has(asset.token.toLowerCase())) assetErrors.push('duplicate canonical token address');
    else usedTokens.add(asset.token.toLowerCase());
    if (!BYTES32.test(asset?.assetId ?? '')) assetErrors.push('canonical asset ID is invalid');
    if (!Number.isInteger(asset?.decimals) || asset.decimals < 0 || asset.decimals > 18) assetErrors.push('token decimals are unsupported');
    if (asset?.schemaVersion !== 11) assetErrors.push('only the reviewed v11 schema is eligible');
    if (JSON.stringify(asset?.capabilities) !== JSON.stringify(PHASES)) assetErrors.push('candidate capability phases are incomplete or out of order');
    if (!ADDRESS.test(asset?.directAdjustedTokenUsd?.proxy ?? '') || asset.directAdjustedTokenUsd.decimals !== 8) {
      assetErrors.push('adjusted-token USD proxy metadata is invalid');
    }
    const feeds = asset?.streamsV11;
    for (const phase of PHASES) {
      const feedId = feeds?.[phase];
      if (!BYTES32.test(feedId ?? '')) assetErrors.push(`${phase} v11 feed ID is invalid`);
      else if (usedFeedIds.has(feedId.toLowerCase())) assetErrors.push(`duplicate v11 feed ID ${feedId}`);
      else usedFeedIds.add(feedId.toLowerCase());
    }
    if (Object.keys(feeds ?? {}).length !== PHASES.length) assetErrors.push('unexpected or missing v11 phase stream');

    const admissionReasons = [];
    for (const key of REQUIRED_ADMISSION_EVIDENCE) {
      if (manifest.admissionEvidence?.[key] !== true) admissionReasons.push(key);
    }
    if (manifest.verifier?.verifiedOnchain !== true) admissionReasons.push('verifierNotVerifiedOnchain');
    if (!BYTES32.test(manifest.verifier?.codeHash ?? '')) admissionReasons.push('verifierCodeHashMissing');
    if (!BYTES32.test(asset?.codeHash ?? '')) admissionReasons.push('tokenCodeHashMissing');
    if (!BYTES32.test(asset?.implementationFingerprint ?? '')) admissionReasons.push('implementationFingerprintMissing');
    if (asset?.sampleReportsVerified !== true) admissionReasons.push('sampleReportsNotVerified');
    if (asset?.entitlementVerified !== true) admissionReasons.push('sourceEntitlementNotVerified');
    if (asset?.admitted === true && admissionReasons.length > 0) assetErrors.push('asset claims admission without all required evidence');

    if (assetErrors.length > 0) errors.push(`${symbol}: ${assetErrors.join('; ')}`);
    const result = Object.freeze({
      symbol,
      admitted: asset?.admitted === true && assetErrors.length === 0 && admissionReasons.length === 0,
      admissionReasons: Object.freeze([...new Set(admissionReasons)]),
    });
    if (result.admitted) admitted.push(result);
    else candidates.push(result);
  }

  const blockers = REQUIRED_ADMISSION_EVIDENCE.filter((key) => manifest?.admissionEvidence?.[key] !== true);
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    blockers: Object.freeze(blockers),
    candidates: Object.freeze(candidates),
    admitted: Object.freeze(admitted),
    assets: Object.freeze([...admitted, ...candidates]),
  });
}
