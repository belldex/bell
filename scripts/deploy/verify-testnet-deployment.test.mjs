import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVerification } from './verify-testnet-deployment.mjs';

const addr = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const CODE = '0x6080604052';

/** Minimal fake viem client: every address has the same code, getters answer from `answers`. */
function fakeClient({ answers = {}, chainId = 46630, blockNumber = 100n, code = CODE } = {}) {
  return {
    getChainId: async () => chainId,
    getBlock: async () => ({ number: blockNumber }),
    getBytecode: async ({ address }) => (address ? code : '0x'),
    readContract: async ({ functionName }) => {
      if (!(functionName in answers)) throw new Error(`unexpected read ${functionName}`);
      return answers[functionName];
    },
  };
}

const manifest = {
  chainId: 46630,
  deployer: addr(1),
  treasury: addr(2),
  serviceRecipient: addr(3),
  permit2: addr(4),
  feeToken: addr(5),
  safetyController: addr(6),
  assetRegistry: addr(7),
  calendarRegistry: addr(8),
  sessionRegistry: addr(9),
  poolManager: addr(10),
  positionManager: addr(11),
  hookDeployer: addr(12),
  poolFactory: addr(13),
  weth: addr(14),
  router: addr(15),
  status: 'REHEARSAL',
  note: '',
};

/** Answers that satisfy every binding in BINDINGS plus the extra reads. */
function wiredAnswers() {
  return {
    poolManager: manifest.poolManager,
    canonicalWeth: manifest.weth,
    WETH9: manifest.weth,
    permit2: manifest.permit2,
    hookDeployer: manifest.hookDeployer,
    positionManager: manifest.positionManager,
    serviceToken: manifest.feeToken,
    serviceRecipient: manifest.serviceRecipient,
    serviceFee: 49000000n,
    liquidityMode: 0,
    factory: manifest.poolFactory,
    templateCodeHash: `0x${'ab'.repeat(32)}`,
    profileHash: `0x${'cd'.repeat(32)}`,
    assetRegistry: manifest.assetRegistry,
    calendarRegistry: manifest.calendarRegistry,
    sessionRegistry: manifest.sessionRegistry,
    safetyController: manifest.safetyController,
    governance: addr(1),
    guardian: addr(3),
    treasury: addr(2),
    owner: manifest.deployer,
    symbol: 'WETH',
    decimals: 18,
  };
}

test('derives every contract address and code size from the chain, not from a previous file', async () => {
  const result = await buildVerification({ manifest, client: fakeClient({ answers: wiredAnswers() }), verifiedAt: '2026-10-27' });
  assert.equal(result.chainId, 46630);
  assert.equal(result.contracts.router.address, manifest.router);
  assert.equal(result.contracts.router.codeBytes, (CODE.length - 2) / 2);
  assert.equal(result.contracts.feeToken.decimals, 18);
  assert.equal(result.contracts.feeToken.label, 'REHEARSAL_FIXTURE_NOT_USDG');
  assert.equal(result.blocks.verifiedAtBlock, 100);
});

test('records the manifest hash so a stale evidence file cannot masquerade as current', async () => {
  const result = await buildVerification({ manifest, client: fakeClient({ answers: wiredAnswers() }), verifiedAt: '2026-10-27' });
  assert.match(result.manifestHash, /^0x[0-9a-f]{64}$/);
  const second = await buildVerification({ manifest, client: fakeClient({ answers: wiredAnswers() }), verifiedAt: '2026-10-27' });
  assert.equal(result.manifestHash, second.manifestHash, 'hash must be deterministic for the same manifest');
  const changed = await buildVerification({ manifest: { ...manifest, note: 'different' }, client: fakeClient({ answers: wiredAnswers() }), verifiedAt: '2026-10-27' });
  assert.notEqual(result.manifestHash, changed.manifestHash);
});

test('refuses to write evidence when a contract has no code on chain', async () => {
  const client = fakeClient({ answers: wiredAnswers() });
  client.getBytecode = async ({ address }) => (address === manifest.router ? '0x' : CODE);
  await assert.rejects(() => buildVerification({ manifest, client, verifiedAt: '2026-10-27' }), /router has no code/i);
});

test('refuses to write evidence when a binding points somewhere else', async () => {
  const answers = wiredAnswers();
  answers.canonicalWeth = addr(999);
  await assert.rejects(
    () => buildVerification({ manifest, client: fakeClient({ answers }), verifiedAt: '2026-10-27' }),
    /wiring mismatch/i,
  );
});

test('refuses a client answering on the wrong chain', async () => {
  await assert.rejects(
    () => buildVerification({ manifest, client: fakeClient({ chainId: 4663, answers: wiredAnswers() }), verifiedAt: '2026-10-27' }),
    /expected 46630/i,
  );
});

test('counts gas from the broadcast receipts when they are available', async () => {
  const broadcast = {
    commit: 'ee407db',
    receipts: [
      { blockNumber: '0x10', gasUsed: '0x64', effectiveGasPrice: '0x2' },
      { blockNumber: '0x14', gasUsed: '0x64', effectiveGasPrice: '0x2' },
    ],
  };
  const result = await buildVerification({ manifest, client: fakeClient({ answers: wiredAnswers() }), broadcast, verifiedAt: '2026-10-27' });
  assert.equal(result.gas.txCount, 2);
  assert.equal(result.gas.used, '200');
  assert.equal(result.blocks.first, 16);
  assert.equal(result.blocks.last, 20);
  assert.equal(result.sourceCommit, 'ee407db');
});

test('defaults stay testnet: a mainnet chain is still rejected without an explicit opt-in', async () => {
  // Guards against a mainnet deployment silently producing testnet-labelled evidence.
  await assert.rejects(
    () => buildVerification({ manifest, client: fakeClient({ chainId: 4663, answers: wiredAnswers() }), verifiedAt: '2026-10-27' }),
    /expected 46630/,
  );
});

test('mainnet verification pins its own chain, status and fee-token label', async () => {
  const mainnetManifest = { ...manifest, chainId: 4663 };
  const result = await buildVerification({
    manifest: mainnetManifest,
    client: fakeClient({ chainId: 4663, answers: wiredAnswers() }),
    verifiedAt: '2026-10-27',
    expectedChainId: 4663,
    status: 'PRODUCTION_DEPLOYED',
    feeTokenLabel: 'PRODUCTION_FEE_TOKEN',
    notCovered: ['no pool yet'],
  });
  assert.equal(result.chainId, 4663);
  assert.equal(result.status, 'PRODUCTION_DEPLOYED');
  assert.equal(result.contracts.feeToken.label, 'PRODUCTION_FEE_TOKEN');
  // A rehearsal label on production evidence would be a lie in the other direction.
  assert.notEqual(result.contracts.feeToken.label, 'REHEARSAL_FIXTURE_NOT_USDG');
  assert.deepEqual(result.notCovered, ['no pool yet']);
});

test('mainnet verification still rejects a testnet chain when mainnet is requested', async () => {
  await assert.rejects(
    () => buildVerification({
      manifest: { ...manifest, chainId: 4663 },
      client: fakeClient({ chainId: 46630, answers: wiredAnswers() }),
      verifiedAt: '2026-10-27',
      expectedChainId: 4663,
    }),
    /expected 4663/,
  );
});
