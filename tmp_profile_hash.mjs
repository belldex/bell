import { encodeAbiParameters, keccak256 } from 'viem';

const config = {
  token0: '0x0000000000000000000000000000000000000000',
  token1: '0x0000000000000000000000000000000000000000',
  asset0: `0x${'0'.repeat(64)}`,
  asset1: `0x${'0'.repeat(64)}`,
  poolManager: '0x00000000000000000000000000000000000000c1',
  positionManager: '0x00000000000000000000000000000000000000c2',
  factory: '0x00000000000000000000000000000000000000c3',
  assetRegistry: '0x00000000000000000000000000000000000000c4',
  calendarRegistry: '0x00000000000000000000000000000000000000c5',
  safetyController: '0x00000000000000000000000000000000000000c6',
  treasuryAdapter: '0x0000000000000000000000000000000000000000',
  poolClass: 1,
  liquidityMode: 0,
  referenceMode: 0,
  tickSpacing: 60,
  tradeCap: [10n, 10n],
  windowCap: [100n, 100n],
  closureCap: [1n, 1n],
  policyId: `0x${'ab'.repeat(32)}`,
  referenceAdapter0: '0x00000000000000000000000000000000000000e1',
  referenceAdapter1: '0x00000000000000000000000000000000000000e2',
};

const hash = keccak256(encodeAbiParameters(
  [{
    type: 'tuple',
    components: [
      { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' },
      { name: 'asset0', type: 'bytes32' }, { name: 'asset1', type: 'bytes32' },
      { name: 'poolManager', type: 'address' }, { name: 'positionManager', type: 'address' },
      { name: 'factory', type: 'address' }, { name: 'assetRegistry', type: 'address' },
      { name: 'calendarRegistry', type: 'address' }, { name: 'safetyController', type: 'address' },
      { name: 'treasuryAdapter', type: 'address' }, { name: 'poolClass', type: 'uint8' },
      { name: 'liquidityMode', type: 'uint8' }, { name: 'referenceMode', type: 'uint8' },
      { name: 'tickSpacing', type: 'int24' }, { name: 'tradeCap', type: 'uint128[2]' },
      { name: 'windowCap', type: 'uint128[2]' }, { name: 'closureCap', type: 'uint128[2]' },
      { name: 'policyId', type: 'bytes32' },
      { name: 'referenceAdapter0', type: 'address' }, { name: 'referenceAdapter1', type: 'address' },
    ],
  }],
  [config],
));
console.log(hash);
