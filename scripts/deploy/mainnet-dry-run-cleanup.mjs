import { rm, writeFile } from 'node:fs/promises';

/** Build the Forge invocation so a dry-run cannot accidentally inherit --broadcast. */
export function buildForgeArgs({ rpcUrl, outDir, cacheDir, broadcast = false } = {}) {
  if (typeof rpcUrl !== 'string' || !rpcUrl) throw new TypeError('rpcUrl is required');
  if (typeof outDir !== 'string' || !outDir) throw new TypeError('outDir is required');
  if (typeof cacheDir !== 'string' || !cacheDir) throw new TypeError('cacheDir is required');
  if (typeof broadcast !== 'boolean') throw new TypeError('broadcast must be a boolean');
  const args = [
    'script', 'script/DeployTestnet.s.sol', '--rpc-url', rpcUrl, '-vv',
    '--out', outDir, '--cache-path', cacheDir,
  ];
  if (broadcast) args.push('--broadcast');
  return args;
}

/** Restore the prior evidence state after a no-broadcast Forge simulation. */
export async function cleanupDryRunArtifacts({ manifestPath, previousManifest, foundryDryRunFiles = [] } = {}) {
  if (typeof manifestPath !== 'string' || manifestPath.length === 0) {
    throw new TypeError('manifestPath is required');
  }
  if (previousManifest !== null && !Buffer.isBuffer(previousManifest)) {
    throw new TypeError('previousManifest must be a Buffer or null');
  }
  if (!Array.isArray(foundryDryRunFiles) || foundryDryRunFiles.some((path) => typeof path !== 'string' || !path)) {
    throw new TypeError('foundryDryRunFiles must be an array of non-empty paths');
  }

  if (previousManifest === null) await rm(manifestPath, { force: true });
  else await writeFile(manifestPath, previousManifest);

  for (const path of foundryDryRunFiles) await rm(path, { force: true, recursive: true });
}
