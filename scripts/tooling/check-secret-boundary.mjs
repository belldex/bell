import { readFile } from 'node:fs/promises';
import { validateSecretBoundary } from './secret-boundary.mjs';

const envExample = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../../.github/workflows/pr.yml', import.meta.url), 'utf8');
validateSecretBoundary({ envExample, workflow });
console.log('Secret boundary checks passed; no credentials are wired into untrusted PR jobs.');
