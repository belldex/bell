const ENTITLEMENT_VALUES = new Set(['NOT_VERIFIED', 'VERIFIED']);
const PERMISSION_VALUES = new Set(['NOT_VERIFIED', 'ALLOWED', 'NOT_ALLOWED']);

function isEntitled(rights) {
  return rights.reportEntitlementA === 'VERIFIED' || rights.reportEntitlementB === 'VERIFIED';
}

export function evaluateSourceRights(rights) {
  if (!rights || typeof rights !== 'object' || typeof rights.discoveryMetadataPublic !== 'boolean') {
    throw new TypeError('source rights record is malformed');
  }
  if (!ENTITLEMENT_VALUES.has(rights.reportEntitlementA) || !ENTITLEMENT_VALUES.has(rights.reportEntitlementB)) {
    throw new Error('source rights report entitlement values are invalid');
  }
  for (const key of ['internalProcessing', 'encryptedBackup', 'rawReportRedistribution', 'derivedCustomerProduct']) {
    if (!PERMISSION_VALUES.has(rights[key])) throw new Error(`source rights ${key} value is invalid`);
  }

  const entitled = isEntitled(rights);
  const internal = rights.internalProcessing === 'ALLOWED';
  const keeperA = rights.reportEntitlementA === 'VERIFIED' && internal;
  const keeperB = rights.reportEntitlementB === 'VERIFIED' && internal;
  const backupRawReports = entitled && internal && rights.encryptedBackup === 'ALLOWED';
  const exposeRawReports = entitled && rights.rawReportRedistribution === 'ALLOWED';
  const sellDerivedData = entitled && internal && rights.derivedCustomerProduct === 'ALLOWED';

  return Object.freeze({
    keeperA,
    keeperB,
    backupRawReports,
    exposeRawReports,
    sellDerivedData,
    discoveryMetadataPublic: rights.discoveryMetadataPublic,
    blockers: Object.freeze({
      keeperA: Object.freeze([...(rights.reportEntitlementA !== 'VERIFIED' ? ['reportEntitlementA'] : []), ...(!internal ? ['internalProcessing'] : [])]),
      keeperB: Object.freeze([...(rights.reportEntitlementB !== 'VERIFIED' ? ['reportEntitlementB'] : []), ...(!internal ? ['internalProcessing'] : [])]),
      backupRawReports: Object.freeze([...(entitled ? [] : ['reportEntitlement']), ...(!internal ? ['internalProcessing'] : []), ...(rights.encryptedBackup !== 'ALLOWED' ? ['encryptedBackup'] : [])]),
      exposeRawReports: Object.freeze([...(entitled ? [] : ['reportEntitlement']), ...(rights.rawReportRedistribution !== 'ALLOWED' ? ['rawReportRedistribution'] : [])]),
      sellDerivedData: Object.freeze([...(entitled ? [] : ['reportEntitlement']), ...(!internal ? ['internalProcessing'] : []), ...(rights.derivedCustomerProduct !== 'ALLOWED' ? ['derivedCustomerProduct'] : [])]),
    }),
  });
}
