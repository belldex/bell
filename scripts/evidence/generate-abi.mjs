import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { compileProjectSolidity } from '../tooling/compile-solidity.mjs';
import { generateAbiManifest } from './abi-manifest.mjs';

export async function generateAbiFile() {
  const output = generateAbiManifest(await compileProjectSolidity());
  const destination = new URL('../../packages/protocol/generated/abi-manifest.json', import.meta.url);
  await mkdir(dirname(fileURLToPath(destination)), { recursive: true });
  await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await generateAbiFile();
  console.log(`Generated ${Object.keys(result.interfaces).length} interface ABIs; sha256=${result.abiSha256}`);
}
