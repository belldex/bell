import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function getMissingBuildPrerequisites({ forge, solc, lockComplete }) {
  const missing = [];
  if (!forge) missing.push('Foundry (forge)');
  if (!solc) missing.push('Solidity compiler (solc)');
  if (!lockComplete) missing.push('complete pinned compatibility lock');
  return missing;
}

function executableExists(command) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(lookup, [command], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

async function main() {
  const lock = JSON.parse(await readFile(new URL('../../toolchain.lock.json', import.meta.url), 'utf8'));
  const solc = await import('solc');
  const solcVersion = solc.default.version().split('+')[0];
  const missing = getMissingBuildPrerequisites({
    forge: executableExists('forge'),
    solc: solcVersion === lock.dependencyCandidates?.solidityCompiler,
    lockComplete: lock.status === 'LOCKED' && Boolean(lock.dependencies?.v4CoreCommit) && Boolean(lock.dependencies?.v4PeripheryCommit),
  });
  if (missing.length > 0) {
    console.error(`Build BLOCKED: missing ${missing.join(', ')}. No production build was attempted.`);
    process.exitCode = 2;
    return;
  }
  console.log(`Toolchain prerequisites present (solc ${solcVersion}); build commands may proceed.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
