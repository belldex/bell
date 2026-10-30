import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import runtimeVector from '@bell/test-vectors/runtime-compat';

describe('Keeper B portable domain dependencies', () => {
  it('runs shared fee and amount logic inside the Workers isolate', async () => {
    const response = await exports.default.fetch('https://bell.test/__test/runtime');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      fee: 5250,
      rawAmount: '125',
      calendarLeafHash: '0xca52218a0f58fd1bc60bc14bc24ce2550ad9316f5a672a67ba2c68d69e78f67e',
      canonicalTokenId: '0x6a3c1eafcf6b3e333b2d803b64a2ea44e6f39c5c4f283e07ac36ef9964942cce',
      sourceWireEncoded: '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000010000000000000000000000001111111111111111111111111111111111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000000000000000000000000000000000000000000000000000000000000000b000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000258bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0000000000000000000000002222222222222222222222222222222222222222cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      swapRequestEncoded: runtimeVector.swapRequestEncoded,
    });
  });

  it('keeps the runtime compatibility route unavailable without an explicit test-only binding', async () => {
    const response = await worker.fetch(new Request('https://bell.test/__test/runtime'), {});
    expect(response.status).toBe(404);
  });
});
