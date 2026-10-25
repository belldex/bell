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
      if (directory.includes(`${sep}test`) && foundryIntegrationOnlyTests.has(entry.name)) continue;
      const path = relative(projectRoot, absolute).replaceAll('\\', '/');
      sources[path] = { content: await readFile(absolute, 'utf8') };
    }
  }
  return sources;
}

export async function compileProjectSolidity() {
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
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const errors = (output.errors ?? []).filter(({ severity }) => severity === 'error');
  if (errors.length > 0) throw new Error(errors.map(({ formattedMessage }) => formattedMessage).join('\n'));
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
