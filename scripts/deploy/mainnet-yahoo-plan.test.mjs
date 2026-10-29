import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { getContractAddress } from 'viem';
import { buildMainnetYahooPlan, verifierRuntimeCodeHash } from './mainnet-yahoo-plan.mjs';
import { buildYahooSourceWire } from '../../packages/protocol/src/yahoo-attestation.mjs';
import { readFile } from 'node:fs/promises';

const PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const TOKEN = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9';
const CODE_HASH = `0x${'ab'.repeat(32)}`;

test('plan-only predicts the verifier CREATE address from deployer and current nonce', () => {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const plan = buildMainnetYahooPlan({
    deployer: account.address,
    deployerNonce: 12n,
    token: TOKEN,
    verifierCodeHash: CODE_HASH,
    symbol: 'AAPL',
    reporter: '0x6C8bAF28eA08DD00A1A64EE350167A70A7b3E98a',
  });

  assert.equal(plan.verifierAddress.toLowerCase(), getContractAddress({ from: account.address, nonce: 12n }).toLowerCase());
  assert.equal(plan.verifierAddressSource, 'predicted');
  assert.equal(plan.wires.length, 3);
  assert.equal(plan.wires[0].scope, 0);
  assert.match(plan.wires[0].sourceConfigHash, /^0x[0-9a-f]{64}$/);
});

test('wire hashes are built against the verifier address that will actually be deployed', () => {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const predicted = getContractAddress({ from: account.address, nonce: 3n });
  const plan = buildMainnetYahooPlan({
    deployer: account.address,
    deployerNonce: 3n,
    token: TOKEN,
    verifierCodeHash: CODE_HASH,
    symbol: 'AAPL',
    reporter: '0x6C8bAF28eA08DD00A1A64EE350167A70A7b3E98a',
  });
  const actualAddressPlan = buildMainnetYahooPlan({
    deployer: account.address,
    deployerNonce: 3n,
    verifierCodeHash: CODE_HASH,
    symbol: 'AAPL',
    token: TOKEN,
    reporter: '0x6C8bAF28eA08DD00A1A64EE350167A70A7b3E98a',
    verifierAddress: predicted,
  });
  const independentlyBuilt = buildYahooSourceWire({
    chainId: 4663,
    token: TOKEN,
    verifier: predicted,
    verifierCodeHash: CODE_HASH,
    phaseScope: 0,
    symbol: 'AAPL',
  });
  assert.equal(plan.wires[0].sourceConfigHash, actualAddressPlan.wires[0].sourceConfigHash);
  assert.equal(plan.wires[0].sourceConfigHash, independentlyBuilt.sourceConfigHash);
  assert.ok(plan.wires.every((wire) => wire.wire.endpoint.toLowerCase() === predicted.toLowerCase()));
});

test('an explicitly supplied verifier address is used for adapter-only recovery deployments', () => {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const verifierAddress = '0x0000000000000000000000000000000000001234';
  const plan = buildMainnetYahooPlan({
    deployer: account.address,
    deployerNonce: 0n,
    token: TOKEN,
    verifierCodeHash: CODE_HASH,
    symbol: 'AAPL',
    reporter: '0x6C8bAF28eA08DD00A1A64EE350167A70A7b3E98a',
    verifierAddress,
  });
  assert.equal(plan.verifierAddress.toLowerCase(), verifierAddress.toLowerCase());
  assert.equal(plan.verifierAddressSource, 'provided');
});

test('missing nonce or malformed token fails before returning a seemingly valid plan', () => {
  const account = privateKeyToAccount(PRIVATE_KEY);
  assert.throws(() => buildMainnetYahooPlan({
    deployer: account.address,
    token: TOKEN,
    verifierCodeHash: CODE_HASH,
    symbol: 'AAPL',
    reporter: account.address,
  }), /deployerNonce/);
  assert.throws(() => buildMainnetYahooPlan({
    deployer: account.address,
    deployerNonce: 0n,
    token: 'not-an-address',
    verifierCodeHash: CODE_HASH,
    symbol: 'AAPL',
    reporter: account.address,
  }), /token/);
});

test('runtime verifier code hash applies the immutable reporter before hashing', async () => {
  const artifact = JSON.parse(await readFile(
    new URL('../../contracts/out/YahooSourceVerifier.sol/YahooSourceVerifier.json', import.meta.url),
    'utf8',
  ));
  const reporter = '0x6C8bAF28eA08DD00A1A64EE350167A70A7b3E98a';

  assert.equal(
    verifierRuntimeCodeHash({
      deployedBytecode: artifact.deployedBytecode.object,
      immutableReferences: artifact.deployedBytecode.immutableReferences,
      reporter,
    }),
    // Runtime code hash read from the live testnet verifier in evidence/deploy/yahoo-verifier-adapter-testnet.json.
    '0xca494970667094bb59a5dfce4376451c811895cd80d90bddbdfeeca4dbafae1a',
  );
});
