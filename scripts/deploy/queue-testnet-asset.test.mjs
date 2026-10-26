import test from 'node:test';
import assert from 'node:assert/strict';
import { previewOrQueueAsset, describeAssetAdmission } from './queue-testnet-asset.mjs';

test('previewOrQueueAsset validates required parameters', async () => {
  await assert.rejects(
    () => previewOrQueueAsset({ tokenAddress: '0x1234' }),
    /rpcUrl is required/
  );
});

test('describes an already-admitted descriptor without creating another queue operation', () => {
  const active = describeAssetAdmission(`0x${'ab'.repeat(32)}`);
  assert.deepEqual(active, { state: 'ACTIVE', descriptorId: `0x${'ab'.repeat(32)}` });
  assert.deepEqual(describeAssetAdmission(`0x${'00'.repeat(32)}`), { state: 'NOT_ADMITTED' });
});
