import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateSourceRights } from '../src/source-rights.mjs';

const defaultRights = {
  discoveryMetadataPublic: true,
  reportEntitlementA: 'NOT_VERIFIED',
  reportEntitlementB: 'NOT_VERIFIED',
  internalProcessing: 'NOT_VERIFIED',
  encryptedBackup: 'NOT_VERIFIED',
  rawReportRedistribution: 'NOT_ALLOWED',
  derivedCustomerProduct: 'NOT_VERIFIED',
};

test('public Discovery metadata does not imply signed-report entitlement or public redistribution', async () => {
  const rights = JSON.parse(await readFile(new URL('../../../config/sources/rights-status.json', import.meta.url), 'utf8'));
  const result = evaluateSourceRights(rights);
  assert.equal(result.keeperA, false);
  assert.equal(result.keeperB, false);
  assert.equal(result.backupRawReports, false);
  assert.equal(result.exposeRawReports, false);
  assert.equal(result.sellDerivedData, false);
});

test('allows only operations explicitly covered by actual rights evidence', () => {
  const result = evaluateSourceRights({
    ...defaultRights,
    reportEntitlementA: 'VERIFIED',
    reportEntitlementB: 'VERIFIED',
    internalProcessing: 'ALLOWED',
    encryptedBackup: 'ALLOWED',
    derivedCustomerProduct: 'ALLOWED',
  });
  assert.equal(result.keeperA, true);
  assert.equal(result.keeperB, true);
  assert.equal(result.backupRawReports, true);
  assert.equal(result.exposeRawReports, false);
  assert.equal(result.sellDerivedData, true);
});

test('rejects unknown rights values instead of widening access', () => {
  assert.throws(() => evaluateSourceRights({ ...defaultRights, rawReportRedistribution: 'MAYBE' }), /rights/i);
});
