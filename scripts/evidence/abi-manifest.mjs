import { createHash } from 'node:crypto';

export function generateAbiManifest(compilerOutput) {
  const sources = Object.entries(compilerOutput?.contracts ?? {})
    .filter(([path]) => path.startsWith('contracts/src/interfaces/'));
  if (sources.length === 0) throw new Error('compiled protocol interfaces are missing');
  const interfaces = Object.fromEntries(sources.flatMap(([, source]) => Object.entries(source))
    .filter(([, artifact]) => Array.isArray(artifact.abi))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, artifact]) => [name, artifact.abi]));
  if (Object.keys(interfaces).length === 0) throw new Error('compiled protocol interface ABI set is empty');
  const canonical = JSON.stringify(interfaces);
  return Object.freeze({
    schemaVersion: 1,
    compilerVersion: compilerOutput.compilerVersion,
    abiSha256: createHash('sha256').update(canonical).digest('hex'),
    interfaces,
  });
}

export function assertAbiManifestCurrent(generated, checkedIn) {
  if (JSON.stringify(generated) !== JSON.stringify(checkedIn)) {
    throw new Error('generated ABI manifest is stale; regenerate from the pinned Solidity compiler');
  }
  return true;
}
