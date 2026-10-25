import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileProjectSolidity } from './compile-solidity.mjs';
import { SOURCE_WIRE_COMPONENTS } from '../../packages/protocol/src/source-codec.mjs';
import { SWAP_REQUEST_COMPONENTS } from '../../packages/protocol/src/swap-codec.mjs';
import { CREATE_REQUEST_COMPONENTS, POOL_CONFIG_COMPONENTS } from '../../packages/protocol/src/create-codec.mjs';

test('compiles normative protocol types with the pinned Solidity compiler', async () => {
  const output = await compileProjectSolidity();
  const harness = output.contracts['contracts/test/ProtocolTypesHarness.sol'].ProtocolTypesHarness;
  assert.ok(harness.abi.some((item) => item.type === 'function' && item.name === 'marketPhaseValues'));
  const swap = harness.abi.find((item) => item.type === 'function' && item.name === 'acceptSwap');
  assert.deepEqual(swap.inputs[0].components.map(({ name, type }) => [name, type]), SWAP_REQUEST_COMPONENTS.map(({ name, type }) => [name, type]));
  const sourceWire = harness.abi.find((item) => item.type === 'function' && item.name === 'acceptSourceWire');
  assert.deepEqual(sourceWire.inputs[0].components.map(({ name, type }) => [name, type]), SOURCE_WIRE_COMPONENTS.map(({ name, type }) => [name, type]));
  const poolConfig = harness.abi.find((item) => item.type === 'function' && item.name === 'acceptPoolConfig');
  assert.deepEqual(poolConfig.inputs[0].components.map(({ name, type }) => [name, type]), POOL_CONFIG_COMPONENTS.map(({ name, type }) => [name, type]));
  const nodes = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(output.sources['contracts/src/types/ProtocolTypes.sol'].ast);
  const marketPhase = nodes.find((node) => node.nodeType === 'EnumDefinition' && node.name === 'MarketPhase');
  assert.deepEqual(marketPhase.members.map(({ name }) => name), ['UNKNOWN', 'PRE', 'REGULAR', 'POST', 'OVERNIGHT', 'CLOSED']);

  const sessionRegistry = output.contracts['contracts/src/interfaces/IBellProtocol.sol'].ISessionRegistry;
  assert.deepEqual(sessionRegistry.abi.filter(({ type }) => type === 'function').map(({ name }) => name), [
    'captureClose', 'closeAnchor', 'health', 'latestSample', 'refreshHealth', 'submitReports',
  ]);
  const calendarRegistry = output.contracts['contracts/src/interfaces/IBellProtocol.sol'].ICalendarRegistry;
  assert.deepEqual(calendarRegistry.abi.filter(({ type }) => type === 'function').map(({ name }) => name), [
    'activateInterval', 'activateRoot', 'cancel', 'currentInterval', 'nextInterval', 'operation', 'queueRoot',
  ]);
  const assetRegistry = output.contracts['contracts/src/interfaces/IBellProtocol.sol'].IAssetRegistry;
  assert.deepEqual(assetRegistry.abi.filter(({ type }) => type === 'function').map(({ name }) => name), [
    'activateAsset', 'cancel', 'descriptor', 'descriptorIdForToken', 'operation', 'queueAsset', 'sourceConfig',
  ]);
  const controller = output.contracts['contracts/src/interfaces/IBellProtocol.sol'].ISafetyController;
  const controllerNames = controller.abi.filter(({ type }) => type === 'function').map(({ name }) => name);
  assert.ok(controllerNames.includes('pausePool'));
  assert.ok(controllerNames.includes('queueResume'));
  assert.equal(controllerNames.some((name) => /sweep|arbitraryCall|callAny|executeOperation/i.test(name)), false);
  const feeHarness = output.contracts['contracts/test/FeePolicyHarness.sol'].FeePolicyHarness;
  assert.ok(feeHarness.abi.some(({ type, name }) => type === 'function' && name === 'bellFee'));
  assert.ok(feeHarness.abi.some(({ type, name }) => type === 'function' && name === 'effectiveLpFee'));
  assert.ok(feeHarness.evm.bytecode.object.length > 0);
  const flowHarness = output.contracts['contracts/test/FlowBudgetHarness.sol'].FlowBudgetHarness;
  assert.ok(flowHarness.abi.some(({ type, name }) => type === 'function' && name === 'consume'));
  assert.ok(flowHarness.abi.some(({ type, name }) => type === 'function' && name === 'effectiveLimits'));
  const closureHarness = output.contracts['contracts/test/ClosureBudgetHarness.sol'].ClosureBudgetHarness;
  assert.ok(closureHarness.abi.some(({ type, name }) => type === 'function' && name === 'maximumClosureCap'));
  assert.ok(closureHarness.abi.some(({ type, name }) => type === 'function' && name === 'consumeEpisode'));
  const events = output.contracts['contracts/src/interfaces/ProtocolEvents.sol'].IBellEvents.abi;
  assert.ok(events.some(({ type, name }) => type === 'event' && name === 'ClosureStarted'));
  assert.ok(events.some(({ type, name }) => type === 'event' && name === 'BudgetConsumed'));
  const errors = output.contracts['contracts/src/interfaces/ProtocolEvents.sol'].IBellErrors.abi;
  assert.ok(errors.some(({ type, name }) => type === 'error' && name === 'PolicyBlocked'));
  assert.ok(errors.some(({ type, name }) => type === 'error' && name === 'SettlementMismatch'));
  const create = harness.abi.find((item) => item.type === 'function' && item.name === 'acceptCreate');
  assert.deepEqual(create.inputs[0].components.map(({ name, type }) => [name, type]), CREATE_REQUEST_COMPONENTS.map(({ name, type }) => [name, type]));
});

test('standard-json compiler profile is fixed to the current candidate config', async () => {
  const output = await compileProjectSolidity();
  const foundry = await readFile(new URL('../../contracts/foundry.toml', import.meta.url), 'utf8');
  assert.equal(output.compilerVersion, '0.8.26');
  assert.equal(output.profile.evmVersion, 'cancun');
  assert.equal(output.profile.optimizerRuns, 200);
  assert.match(foundry, /^solc_version\s*=\s*"0\.8\.26"$/m);
  assert.match(foundry, /^optimizer_runs\s*=\s*200$/m);
  assert.match(foundry, /^evm_version\s*=\s*"cancun"$/m);
});
