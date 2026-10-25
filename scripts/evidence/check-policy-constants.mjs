import { readFile } from 'node:fs/promises';
import { renderPolicyConstants } from './generate-policy-constants.mjs';

const current = await readFile(new URL('../../contracts/src/libraries/PolicyConstants.sol', import.meta.url), 'utf8');
const policy = JSON.parse(await readFile(new URL('../../config/policy/policy-v1.json', import.meta.url), 'utf8'));
if (current !== renderPolicyConstants(policy)) throw new Error('PolicyConstants.sol is stale; regenerate it from policy-v1.json');
console.log('Generated Solidity policy constants match config/policy/policy-v1.json.');
