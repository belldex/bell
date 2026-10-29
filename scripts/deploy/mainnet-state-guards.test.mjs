import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mainnet calendar and admission commands explain missing live deployment state', async () => {
  const calendar = await readFile(new URL('./mainnet-calendar.mjs', import.meta.url), 'utf8');
  const admission = await readFile(new URL('./mainnet-admit-assets.mjs', import.meta.url), 'utf8');
  assert.match(calendar, /mainnet-4663\.json.*not found|mainnet deployment manifest is missing/i);
  assert.match(admission, /mainnet-4663\.json.*not found|mainnet deployment manifest is missing/i);
});
