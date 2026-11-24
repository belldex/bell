import { readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
import solc from 'solc';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const contractsRoot = resolve(projectRoot, 'contracts');
const foundryIntegrationOnlyTests = new Set([
  'BaseHookCompatibilityHarness.sol',
  'PeripheryCompatibilityHarness.sol',
  'V4CoreCompatibility.t.sol',
  // The Lens and its Foundry parity suite require the production via-IR profile.
  'BellSwapLens.t.sol',
]);
const pinnedDependencyRemappings = [
  ['@uniswap/v4-core/', 'contracts/lib/v4-core/'],
  ['@openzeppelin/contracts/', 'contracts/lib/openzeppelin-contracts/contracts/'],
  ['openzeppelin-contracts/', 'contracts/lib/openzeppelin-contracts/'],
  ['permit2/', 'contracts/lib/permit2/'],
  ['solmate/', 'contracts/lib/solmate/'],
];

// Production sources inherit the pinned BaseHook and import v4-core through the Foundry remappings. Resolve
// those pinned dependency imports for the standalone solc profile so `compile:solidity` covers first-party
// contracts instead of skipping them as Foundry-only harnesses.
function resolveImport(importPath) {
  let normalized = importPath;
  for (const [prefix, target] of pinnedDependencyRemappings) {
    if (normalized.startsWith(prefix)) {
      normalized = `${target}${normalized.slice(prefix.length)}`;
      break;
    }
  }
  const absolute = resolve(projectRoot, normalized);
  if (!absolute.startsWith(projectRoot)) return { error: `Import escapes the project root: ${importPath}` };
  try {
    return { contents: readFileSync(absolute, 'utf8') };
  }
  catch {
    return { error: `Unable to resolve import: ${importPath}` };
  }
}

async function collectSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = {};
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(sources, await collectSources(absolute));
    }
    else if (entry.isFile() && entry.name.endsWith('.sol')) {
      // Foundry .t.sol suites use cheatcodes and the production via-IR profile; the
      // standalone compiler covers source contracts and non-Foundry harnesses.
      if (directory.includes(`${sep}test`) && (entry.name.endsWith('.t.sol') || foundryIntegrationOnlyTests.has(entry.name))) continue;
      const path = relative(projectRoot, absolute).replaceAll('\\', '/');
      sources[path] = { content: await readFile(absolute, 'utf8') };
    }
  }
  return sources;
}

let memo;
export function compileProjectSolidity() {
  return (memo ??= compileOnce());
}

async function compileOnce() {
  const sources = {};
  const sourceDirs = [resolve(contractsRoot, 'src'), resolve(contractsRoot, 'test')];
  for (const directory of sourceDirs) {
    try {
      Object.assign(sources, await collectSources(directory));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (Object.keys(sources).length === 0) throw new Error('No Solidity sources found');
  const lensPath = 'contracts/src/BellSwapLens.sol';
  const lensSource = sources[lensPath];
  delete sources[lensPath];
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      metadata: { bytecodeHash: 'none' },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'], '': ['ast'] } },
    },
  };
  let output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  let errors = (output.errors ?? []).filter(({ severity }) => severity === 'error');
  // The policy oracle's evaluate() exceeds the legacy code generator's stack limit, and production builds it with via-IR (foundry.toml), which
  // forge build covers in CI. When the legacy pass fails only on stack depth, repeat it without code generation for the production sources:
  // ABI and AST for everything, bytecode only for the test harnesses.
  if (errors.length > 0 && errors.every(({ message }) => /Stack too deep/.test(message ?? ''))) {
    input.settings.outputSelection = { '*': { '*': ['abi'], '': ['ast'] } };
    output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
    errors = (output.errors ?? []).filter(({ severity }) => severity === 'error');
    if (errors.length === 0) {
      // One bytecode request makes solc generate code for every contract in the unit, so the harnesses get their own compile.
      const harnessSources = Object.fromEntries(Object.entries(sources).filter(([path]) => path.startsWith('contracts/test/')));
      const harness = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: harnessSources, settings: {
        optimizer: input.settings.optimizer, evmVersion: 'cancun', metadata: input.settings.metadata,
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
      } }), { import: resolveImport }));
      errors = (harness.errors ?? []).filter(({ severity }) => severity === 'error');
      for (const path of Object.keys(harnessSources)) if (harness.contracts?.[path]) output.contracts[path] = harness.contracts[path];
    }
  }
  if (errors.length > 0) throw new Error(errors.map(({ formattedMessage }) => formattedMessage).join('\n'));
  // Lens quote traversal exceeds the legacy code generator's stack limit. Compile it
  // independently using the same via-IR settings as the deployable Foundry artifact.
  if (lensSource) {
    const lensInput = { language: 'Solidity', sources: { [lensPath]: lensSource }, settings: {
      optimizer: { enabled: true, runs: 1 }, viaIR: true, evmVersion: 'cancun',
      metadata: { bytecodeHash: 'none' },
      outputSelection: { [lensPath]: { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    } };
    const lensOutput = JSON.parse(solc.compile(JSON.stringify(lensInput), { import: resolveImport }));
    const lensErrors = (lensOutput.errors ?? []).filter(({ severity }) => severity === 'error');
    if (lensErrors.length) throw new Error(lensErrors.map(({ formattedMessage }) => formattedMessage).join('\n'));
    output.contracts[lensPath] = lensOutput.contracts[lensPath];
  }
  return Object.freeze({
    ...output,
    compilerVersion: solc.version().split('+')[0],
    profile: Object.freeze({ evmVersion: 'cancun', optimizerRuns: 200, bytecodeHash: 'none' }),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const output = await compileProjectSolidity();
  console.log(`solc ${output.compilerVersion}: compiled ${Object.keys(output.contracts).length} source files (first-party plus pinned imports) with ABI, AST, and bytecode outputs.`);
}
