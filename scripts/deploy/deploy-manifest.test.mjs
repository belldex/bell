import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeployManifest, formatDeployManifest } from './deploy-manifest.mjs';

const VALID_MANIFEST = Object.freeze({
  chainId: 46630,
  deployer: '0x1111111111111111111111111111111111111111',
  treasury: '0x2222222222222222222222222222222222222222',
  serviceRecipient: '0x3333333333333333333333333333333333333333',
  feeToken: '0x4444444444444444444444444444444444444444',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  safetyController: '0x5555555555555555555555555555555555555555',
  assetRegistry: '0x6666666666666666666666666666666666666666',
  calendarRegistry: '0x7777777777777777777777777777777777777777',
  sessionRegistry: '0x8888888888888888888888888888888888888888',
  poolManager: '0x9999999999999999999999999999999999999999',
  positionManager: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  hookDeployer: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  poolFactory: '0xcccccccccccccccccccccccccccccccccccccccc',
  weth: '0xdddddddddddddddddddddddddddddddddddddddd',
  router: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  status: 'REHEARSAL',
  note: 'Robinhood testnet rehearsal manifest'
});

test('validates correct Robinhood testnet deploy manifest', () => {
  const validated = validateDeployManifest(VALID_MANIFEST);
  assert.equal(validated.chainId, 46630);
  assert.equal(validated.deployer, '0x1111111111111111111111111111111111111111');
  assert.equal(validated.status, 'REHEARSAL');
});

test('rejects wrong chainId', () => {
  assert.throws(
    () => validateDeployManifest({ ...VALID_MANIFEST, chainId: 1 }),
    /chainId must be a supported Robinhood chain/
  );
});

test('accepts the Robinhood mainnet chain and keeps the chain id it was given', () => {
  const mainnet = validateDeployManifest({ ...VALID_MANIFEST, chainId: 4663, status: 'PRODUCTION' });
  assert.equal(mainnet.chainId, 4663);
  assert.equal(mainnet.status, 'PRODUCTION');
});

test('rejects an unknown chain instead of guessing a deployment target', () => {
  assert.throws(
    () => validateDeployManifest({ ...VALID_MANIFEST, chainId: 8453 }),
    /chainId must be a supported Robinhood chain/
  );
});

test('rejects missing or placeholder addresses', () => {
  assert.throws(
    () => validateDeployManifest({ ...VALID_MANIFEST, poolFactory: '0x0000000000000000000000000000000000000000' }),
    /poolFactory cannot be zero address/
  );
  assert.throws(
    () => validateDeployManifest({ ...VALID_MANIFEST, router: 'replace-with-address' }),
    /router must be a valid 40-hex address/
  );
});

test('formats deploy manifest canonically with stable hash', () => {
  const formatted = formatDeployManifest(VALID_MANIFEST);
  assert.ok(formatted.manifestHash.startsWith('0x'));
  assert.equal(formatted.manifestHash.length, 66);
  assert.equal(formatted.manifest.chainId, 46630);
});

test('preserves optional policy oracle and rejects a zero oracle address', () => {
  const policyOracle = '0xABabABabABabABabABabABabABabABabABabABab';
  const mainnet = validateDeployManifest({ ...VALID_MANIFEST, chainId: 4663, policyOracle });
  assert.equal(mainnet.policyOracle, policyOracle.toLowerCase());
  assert.throws(
    () => validateDeployManifest({ ...VALID_MANIFEST, chainId: 4663, policyOracle: '0x0000000000000000000000000000000000000000' }),
    /policyOracle cannot be zero address/,
  );
});
