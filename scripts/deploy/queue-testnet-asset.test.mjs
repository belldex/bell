import test from 'node:test';
import assert from 'node:assert/strict';
import { previewOrQueueAsset } from './queue-testnet-asset.mjs';

test('previewOrQueueAsset validates required parameters', async () => {
  await assert.rejects(
    () => previewOrQueueAsset({ tokenAddress: '0x1234' }),
    /rpcUrl is required/
  );
});
