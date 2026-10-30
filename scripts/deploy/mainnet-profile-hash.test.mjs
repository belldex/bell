import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveProfileHash, resolvePoolConfig } from './mainnet-pool-config.mjs';
import { keccak256, stringToHex } from 'viem';

const WIRING = {
  poolManager: '0x00000000000000000000000000000000000000c1',
  positionManager: '0x00000000000000000000000000000000000000c2',
  factory: '0x00000000000000000000000000000000000000c3',
  assetRegistry: '0x00000000000000000000000000000000000000c4',
  calendarRegistry: '0x00000000000000000000000000000000000000c5',
  safetyController: '0x00000000000000000000000000000000000000c6',
};

function config(overrides = {}) {
  return {
    token0: '0x00000000000000000000000000000000000000aa',
    token1: '0x00000000000000000000000000000000000000bb',
    asset0: `0x${'11'.repeat(32)}`,
    asset1: `0x${'22'.repeat(32)}`,
    ...WIRING,
    treasuryAdapter: '0x0000000000000000000000000000000000000000',
    poolClass: 1,
    liquidityMode: 0,
    referenceMode: 0,
    tickSpacing: 60,
    tradeCap: [10n, 10n],
    windowCap: [100n, 100n],
    closureCap: [1n, 1n],
    policyId: keccak256(stringToHex('bell-mainnet-v1')),
    referenceAdapter0: '0x0000000000000000000000000000000000000000',
    referenceAdapter1: '0x0000000000000000000000000000000000000000',
    ...overrides,
  };
}

test('the profile hash ignores the pool tokens and asset ids, like the factory does', () => {
  const a = deriveProfileHash(config());
  const b = deriveProfileHash(config({
    token0: '0x00000000000000000000000000000000000000cc',
    token1: '0x00000000000000000000000000000000000000dd',
    asset0: `0x${'33'.repeat(32)}`,
    asset1: `0x${'44'.repeat(32)}`,
  }));
  assert.equal(a, b);
});

test('the profile hash does include policyId, so a mismatched label is caught before gas is spent', () => {
  const mainnet = deriveProfileHash(config({ policyId: keccak256(stringToHex('bell-mainnet-v1')) }));
  const testnet = deriveProfileHash(config({ policyId: keccak256(stringToHex('bell-testnet-v1')) }));
  assert.notEqual(mainnet, testnet);
});

test('the profile hash includes tickSpacing and the caps', () => {
  const base = deriveProfileHash(config());
  assert.notEqual(base, deriveProfileHash(config({ tickSpacing: 10 })));
  assert.notEqual(base, deriveProfileHash(config({ tradeCap: [11n, 10n] })));
  assert.notEqual(base, deriveProfileHash(config({ windowCap: [101n, 100n] })));
  assert.notEqual(base, deriveProfileHash(config({ closureCap: [2n, 1n] })));
  assert.notEqual(base, deriveProfileHash(config({ liquidityMode: 1 })));
});

test('one factory profile can serve both pool classes and per-pair reference adapters', () => {
  const base = config({
    poolClass: 1,
    referenceAdapter0: '0x0000000000000000000000000000000000000000',
    referenceAdapter1: '0x0000000000000000000000000000000000000000',
  });
  const guarded = config({
    poolClass: 0,
    referenceAdapter0: '0x00000000000000000000000000000000000000d1',
    referenceAdapter1: '0x00000000000000000000000000000000000000d2',
  });
  assert.equal(deriveProfileHash(base), deriveProfileHash(guarded));
});

test('the profile hash is a bytes32', () => {
  assert.match(deriveProfileHash(config()), /^0x[0-9a-f]{64}$/);
});

test('the per-pool hook config hash will bind reference adapters; factory deployment profile is shared', () => {
  const base = deriveProfileHash(config());
  assert.equal(base, deriveProfileHash(config({ referenceAdapter0: '0x00000000000000000000000000000000000000d1' })));
  assert.equal(base, deriveProfileHash(config({ referenceAdapter1: '0x00000000000000000000000000000000000000d2' })));
  assert.equal(
    deriveProfileHash(config({ referenceAdapter0: '0x00000000000000000000000000000000000000d1', referenceAdapter1: '0x00000000000000000000000000000000000000d2' })),
    deriveProfileHash(config({ referenceAdapter0: '0x00000000000000000000000000000000000000d2', referenceAdapter1: '0x00000000000000000000000000000000000000d1' })),
  );
});

test('resolvePoolConfig derives a config whose profile hash matches deriveProfileHash', () => {
  const resolved = resolvePoolConfig({
    tokenA: '0x00000000000000000000000000000000000000aa',
    assetA: `0x${'11'.repeat(32)}`,
    tokenB: '0x00000000000000000000000000000000000000bb',
    assetB: `0x${'22'.repeat(32)}`,
    amountAMax: 1n,
    amountBMax: 1n,
    ...WIRING,
    policyId: 'bell-mainnet-v1',
  });
  // This is the exact comparison mainnet-create-pool.mjs runs against the deployed factory.
  assert.equal(deriveProfileHash(resolved.config), deriveProfileHash(config()));
});

test('resolvePoolConfig defaults reference adapters to the zero address and validates inputs', () => {
  const base = {
    tokenA: '0x00000000000000000000000000000000000000aa',
    assetA: `0x${'11'.repeat(32)}`,
    tokenB: '0x00000000000000000000000000000000000000bb',
    assetB: `0x${'22'.repeat(32)}`,
    amountAMax: 1n,
    amountBMax: 1n,
    ...WIRING,
  };
  const resolved = resolvePoolConfig(base);
  assert.equal(resolved.config.referenceAdapter0, '0x0000000000000000000000000000000000000000');
  assert.equal(resolved.config.referenceAdapter1, '0x0000000000000000000000000000000000000000');
  const withAdapters = resolvePoolConfig({
    ...base,
    poolClass: 0,
    referenceAdapterA: '0x00000000000000000000000000000000000000E1',
    referenceAdapterB: '0x00000000000000000000000000000000000000E2',
  });
  assert.equal(withAdapters.config.referenceAdapter0, '0x00000000000000000000000000000000000000e1');
  assert.equal(withAdapters.config.referenceAdapter1, '0x00000000000000000000000000000000000000e2');
  // Factory deployment profile is shared across pools; pool-specific configHash binds these refs.
  assert.equal(deriveProfileHash(resolved.config), deriveProfileHash(withAdapters.config));
  assert.throws(() => resolvePoolConfig({ ...base, referenceAdapterA: 'not-an-address' }), /referenceAdapterA/);
});

test('a testnet policy label produces a different profile hash than the mainnet one', () => {
  const base = {
    tokenA: '0x00000000000000000000000000000000000000aa',
    assetA: `0x${'11'.repeat(32)}`,
    tokenB: '0x00000000000000000000000000000000000000bb',
    assetB: `0x${'22'.repeat(32)}`,
    amountAMax: 1n,
    amountBMax: 1n,
    ...WIRING,
  };
  const mainnet = resolvePoolConfig({ ...base, policyId: 'bell-mainnet-v1' });
  const testnet = resolvePoolConfig({ ...base, policyId: 'bell-testnet-v1' });
  assert.notEqual(deriveProfileHash(mainnet.config), deriveProfileHash(testnet.config));
  assert.match(mainnet.policyIdHash, /^0x[0-9a-f]{64}$/);
  assert.notEqual(mainnet.policyIdHash, testnet.policyIdHash);
});
