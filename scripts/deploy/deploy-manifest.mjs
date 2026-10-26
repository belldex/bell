import { createHash } from 'node:crypto';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function validateDeployManifest(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('Deploy manifest must be an object');

  const chainId = Number(raw.chainId);
  if (chainId !== 46630) {
    throw new RangeError(`chainId must be Robinhood testnet 46630, received: ${raw.chainId}`);
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

  const validated = { chainId: 46630 };

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

  // Optional fee token
  if (raw.feeToken !== undefined && raw.feeToken !== null) {
    if (typeof raw.feeToken !== 'string' || !ADDRESS_RE.test(raw.feeToken)) {
      throw new TypeError('feeToken must be a valid 40-hex address');
    }
    validated.feeToken = raw.feeToken.toLowerCase();
  } else {
    validated.feeToken = ZERO_ADDRESS;
  }

  validated.status = String(raw.status || 'REHEARSAL');
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
