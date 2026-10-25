const HASH = /^0x[0-9a-f]{64}$/i;

function probeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseQuantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseBlock(block) {
  const blockNumber = parseQuantity(block?.number);
  if (blockNumber === null || !HASH.test(block?.hash ?? '')) return null;
  return { blockNumber, blockHash: block.hash.toLowerCase() };
}

export async function probeChainHead(client, expectedChainId) {
  if (!client || typeof client.call !== 'function' || !['alchemy', 'pinax'].includes(client.provider)) {
    throw new TypeError('preflight requires an authenticated Alchemy or Pinax RPC client');
  }
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) throw new RangeError('expected chain ID must be positive');
  const chainValue = parseQuantity(await client.call('eth_chainId', []));
  if (chainValue === null || chainValue !== BigInt(expectedChainId)) {
    throw probeError('CHAIN_ID_MISMATCH', `RPC chain ID does not match expected ${expectedChainId}`);
  }
  const block = parseBlock(await client.call('eth_getBlockByNumber', ['latest', false]));
  if (!block) throw probeError('MALFORMED_HEAD', 'RPC returned an invalid latest block number or hash');
  return Object.freeze({ provider: client.provider, chainId: expectedChainId, ...block });
}

export async function compareAtCommonBlock(clientA, headA, clientB, headB) {
  if (headA.chainId !== headB.chainId) return Object.freeze({ agree: false, reason: 'CHAIN_ID_MISMATCH' });
  const blockNumber = headA.blockNumber < headB.blockNumber ? headA.blockNumber : headB.blockNumber;
  const blockTag = `0x${blockNumber.toString(16)}`;
  const [blockA, blockB] = await Promise.all([
    clientA.call('eth_getBlockByNumber', [blockTag, false]),
    clientB.call('eth_getBlockByNumber', [blockTag, false]),
  ]);
  const parsedA = parseBlock(blockA);
  const parsedB = parseBlock(blockB);
  if (!parsedA || !parsedB || parsedA.blockNumber !== blockNumber || parsedB.blockNumber !== blockNumber) {
    return Object.freeze({ agree: false, reason: 'COMMON_BLOCK_UNAVAILABLE', blockNumber });
  }
  if (parsedA.blockHash !== parsedB.blockHash) {
    return Object.freeze({ agree: false, reason: 'BLOCK_HASH_MISMATCH', blockNumber });
  }
  return Object.freeze({ agree: true, reason: null, blockNumber, blockHash: parsedA.blockHash });
}
