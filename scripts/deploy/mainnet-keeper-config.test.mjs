import test from 'node:test';
import assert from 'node:assert/strict';

const configModule = await import('./mainnet-keeper-config-lib.mjs').catch(() => null);

test('builds the mainnet multi-asset keeper vars from active evidence without requiring a pool', () => {
  assert.equal(typeof configModule?.buildMainnetKeeperVars, 'function');
  const build = configModule.buildMainnetKeeperVars;
  const manifest = {
    chainId: 4663,
    calendarRegistry: '0x0000000000000000000000000000000000000011',
    sessionRegistry: '0x0000000000000000000000000000000000000012',
  };
  const broadcast = { chainId: 4663, status: 'BROADCASTED_AND_LIVE_CODE_VERIFIED' };
  const adapters = {
    chainId: 4663,
    verifier: '0x0000000000000000000000000000000000000013',
    assets: {
      AAPL: {
        stockToken: '0x0000000000000000000000000000000000000021',
        directAdapter: '0x0000000000000000000000000000000000000031',
        directWireHash: `0x${'31'.repeat(32)}`,
        regularWire: { feedId: `0x${'41'.repeat(32)}` },
        regularWireHash: `0x${'42'.repeat(32)}`,
        extendedWire: { feedId: `0x${'51'.repeat(32)}` },
        extendedWireHash: `0x${'52'.repeat(32)}`,
      },
    },
  };
  const assets = {
    chainId: 4663,
    activationPending: false,
    stocks: {
      AAPL: {
        symbol: 'AAPL',
        token: '0x0000000000000000000000000000000000000021',
        descriptorId: `0x${'61'.repeat(32)}`,
      },
    },
  };
  const assetState = {
    chainId: 4663,
    stage: 'ACTIVE',
    stocks: { AAPL: { descriptorId: `0x${'61'.repeat(32)}`, active: true } },
  };
  const calendarStates = {
    AAPL: { chainId: 4663, assetLabel: 'AAPL', stage: 'INTERVAL_ACTIVE' },
  };

  const vars = build({ manifest, broadcast, adapters, assets, assetState, calendarStates });
  expectJson(vars.BELL_STOCK_ASSETS, [{ symbol: 'AAPL', assetId: `0x${'61'.repeat(32)}` }]);
  expectJson(vars.BELL_MAINNET_ASSETS, {
    AAPL: {
      directAdapter: '0x0000000000000000000000000000000000000031',
      directWireHash: `0x${'31'.repeat(32)}`,
      regularWire: { feedId: `0x${'41'.repeat(32)}` },
      regularWireHash: `0x${'42'.repeat(32)}`,
      extendedWire: { feedId: `0x${'51'.repeat(32)}` },
      extendedWireHash: `0x${'52'.repeat(32)}`,
    },
  });
  assert.equal(vars.BELL_EXPECTED_CHAIN_ID, '4663');
  assert.equal(vars.BELL_ORACLE_MODE, 'pull');
  assert.equal('BELL_TRANSACTION_PRIVATE_KEY' in vars, false);
  assert.equal(vars.BELL_SESSION_REGISTRY, manifest.sessionRegistry);
  assert.equal(vars.BELL_CALENDAR_REGISTRY, manifest.calendarRegistry);
  assert.equal(vars.YAHOO_SOURCE_VERIFIER_ADDRESS, adapters.verifier);
  assert.equal('BELL_HOOK_ADDRESS' in vars, false);
});

test('refuses incomplete or non-mainnet keeper evidence', () => {
  assert.equal(typeof configModule?.buildMainnetKeeperVars, 'function');
  const build = configModule.buildMainnetKeeperVars;
  assert.throws(() => build({ manifest: { chainId: 46630 } }), /chainId/);
});

test('replaces only the Wrangler vars object when values contain nested JSON', () => {
  assert.equal(typeof configModule?.replaceWranglerVars, 'function');
  const source = '{\n  "vars": { "OLD": "value" },\n  "triggers": { "crons": ["*/1 * * * *"] }\n}\n';
  const updated = configModule.replaceWranglerVars(source, {
    BELL_STOCK_ASSETS: JSON.stringify([{ symbol: 'AAPL', assetId: `0x${'61'.repeat(32)}` }]),
  });
  assert.match(updated, /"BELL_STOCK_ASSETS"/);
  assert.match(updated, /"triggers"/);
  assert.doesNotMatch(updated, /"OLD"/);
  const varsStart = updated.indexOf('"vars"');
  const triggersStart = updated.indexOf('"triggers"');
  const varsText = updated.slice(varsStart, triggersStart);
  assert.match(varsText, /AAPL/);
  assert.match(varsText, /assetId/);
});

function expectJson(value, expected) {
  assert.deepEqual(JSON.parse(value), expected);
}
