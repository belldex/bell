import { createHash } from 'node:crypto';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Chains this deployment tooling is allowed to target. Anything else fails closed. */
export const SUPPORTED_CHAIN_IDS = Object.freeze({
  46630: 'REHEARSAL',
  4663: 'PRODUCTION',
});

export function validateDeployManifest(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('Deploy manifest must be an object');

  const chainId = Number(raw.chainId);
  if (!Object.hasOwn(SUPPORTED_CHAIN_IDS, chainId)) {
    throw new RangeError(
      `chainId must be a supported Robinhood chain (46630 testnet or 4663 mainnet), received: ${raw.chainId}`,
    );
  }

  const requiredAddresses = [
    'deployer',
    'treasury',
    'serviceRecipient',
    'permit2',
    'safetyController',
    'assetRegistry',
    'calendarRegistry',
    'sessionRegistry',
    'poolManager',
    'positionManager',
    'hookDeployer',
    'poolFactory',
    'weth',
    'router'
  ];

  const validated = { chainId };

  for (const field of requiredAddresses) {
    const val = raw[field];
    if (typeof val !== 'string' || !ADDRESS_RE.test(val)) {
      throw new TypeError(`${field} must be a valid 40-hex address`);
    }
    if (val.toLowerCase() === ZERO_ADDRESS) {
      throw new RangeError(`${field} cannot be zero address`);
    }
    validated[field] = val.toLowerCase();
  }

  if (raw.modeEvaluator !== undefined && raw.modeEvaluator !== null) {
    if (typeof raw.modeEvaluator !== 'string' || !ADDRESS_RE.test(raw.modeEvaluator)) {
      throw new TypeError('modeEvaluator must be a valid 40-hex address');
    }
    if (raw.modeEvaluator.toLowerCase() === ZERO_ADDRESS) throw new RangeError('modeEvaluator cannot be zero address');
    validated.modeEvaluator = raw.modeEvaluator.toLowerCase();
  }

  // Optional fee token
  if (raw.feeToken !== undefined && raw.feeToken !== null) {
    if (typeof raw.feeToken !== 'string' || !ADDRESS_RE.test(raw.feeToken)) {
      throw new TypeError('feeToken must be a valid 40-hex address');
    }
    validated.feeToken = raw.feeToken.toLowerCase();
  } else {
    validated.feeToken = ZERO_ADDRESS;
  }

  // Default the status to the chain's own profile so a mainnet manifest cannot be mislabelled
  // as a rehearsal by omission.
  validated.status = String(raw.status || SUPPORTED_CHAIN_IDS[chainId]);
  validated.note = String(raw.note || '');

  return Object.freeze(validated);
}

export function formatDeployManifest(raw) {
  const validated = validateDeployManifest(raw);
  const canonicalJson = JSON.stringify(validated, Object.keys(validated).sort(), 2);
  const manifestHash = '0x' + createHash('sha256').update(canonicalJson).digest('hex');
  return Object.freeze({
    manifest: validated,
    canonicalJson,
    manifestHash
  });
}
