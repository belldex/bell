import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compileProjectSolidity } from '../tooling/compile-solidity.mjs';
import { assertAbiManifestCurrent, generateAbiManifest } from './abi-manifest.mjs';

const checkedIn = JSON.parse(await readFile(new URL('../../packages/protocol/generated/abi-manifest.json', import.meta.url), 'utf8'));
const generated = generateAbiManifest(await compileProjectSolidity());
assertAbiManifestCurrent(generated, checkedIn);
console.log(`Generated ABI manifest is current (${Object.keys(generated.interfaces).length} interfaces).`);
