import test from 'node:test';
import assert from 'node:assert/strict';
import { selectChainlinkCredential } from './chainlink-credential.mjs';

test('selects a separate testnet credential while preserving mainnet credential', () => {
  const selected = selectChainlinkCredential({
    CHAINLINK_SOURCE_CREDENTIAL_A: 'main-user:main-secret',
    CHAINLINK_TESTNET_SOURCE_CREDENTIAL: 'test-user:test-secret',
  }, 'https://api.testnet-dataengine.chain.link');
  assert.deepEqual(selected, { username: 'test-user', secret: 'test-secret', network: 'testnet' });
});

test('does not silently send mainnet credentials to Chainlink Testnet', () => {
  assert.throws(
    () => selectChainlinkCredential({ CHAINLINK_SOURCE_CREDENTIAL_A: 'main-user:main-secret' }, 'https://api.testnet-dataengine.chain.link'),
    /CHAINLINK_TESTNET_SOURCE_CREDENTIAL is required/
  );
});

test('continues to use the verified mainnet credential for the mainnet endpoint', () => {
  const selected = selectChainlinkCredential({
    CHAINLINK_SOURCE_CREDENTIAL_A: 'main-user:main-secret',
    CHAINLINK_TESTNET_SOURCE_CREDENTIAL: 'test-user:test-secret',
  }, 'https://api.dataengine.chain.link');
  assert.deepEqual(selected, { username: 'main-user', secret: 'main-secret', network: 'mainnet' });
});
