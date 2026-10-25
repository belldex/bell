import { fileURLToPath } from 'node:url';
import { createRpcClient } from './rpc-client.mjs';
import { compareAtCommonBlock, probeChainHead } from './rpc-preflight.mjs';

function unavailable(provider, error) {
  return Object.freeze({ provider, status: 'UNAVAILABLE', reason: error?.code ?? 'PROBE_FAILED' });
}

export async function collectRpcPreflight({ expectedChainId, primary, secondary }) {
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) throw new RangeError('expectedChainId must be positive');
  if (!primary || !secondary) {
    return Object.freeze({
      status: 'BLOCKED_ACCESS',
      providersAgree: false,
      providerResults: Object.freeze([
        primary ? { provider: primary.provider, status: 'CONFIGURED' } : { provider: 'alchemy', status: 'MISSING_CREDENTIAL' },
        secondary ? { provider: secondary.provider, status: 'CONFIGURED' } : { provider: 'pinax', status: 'MISSING_CREDENTIAL' },
      ]),
      commonBlock: null,
      mainnetBroadcastAllowed: false,
    });
  }
  if (primary.provider !== 'alchemy' || secondary.provider !== 'pinax') {
    throw new TypeError('Primary must be Alchemy and secondary must be Pinax');
  }

  const settled = await Promise.allSettled([
    probeChainHead(primary, expectedChainId),
    probeChainHead(secondary, expectedChainId),
  ]);
  if (settled.some((entry) => entry.status === 'rejected')) {
    return Object.freeze({
      status: 'PROVIDER_UNAVAILABLE',
      providersAgree: false,
      providerResults: Object.freeze(settled.map((entry, index) => entry.status === 'fulfilled'
        ? { provider: entry.value.provider, status: 'HEAD_READ_OK', blockNumber: entry.value.blockNumber.toString() }
        : unavailable(index === 0 ? 'alchemy' : 'pinax', entry.reason))),
      commonBlock: null,
      mainnetBroadcastAllowed: false,
    });
  }

  const [headA, headB] = settled.map((entry) => entry.value);
  let comparison;
  try {
    comparison = await compareAtCommonBlock(primary, headA, secondary, headB);
  } catch (error) {
    return Object.freeze({
      status: 'COMMON_BLOCK_UNAVAILABLE',
      providersAgree: false,
      reason: error?.code ?? 'COMMON_BLOCK_PROBE_FAILED',
      providerResults: Object.freeze([
        { provider: 'alchemy', status: 'COMMON_BLOCK_READ_UNCONFIRMED', blockNumber: headA.blockNumber.toString() },
        { provider: 'pinax', status: 'COMMON_BLOCK_READ_UNCONFIRMED', blockNumber: headB.blockNumber.toString() },
      ]),
      commonBlock: null,
      mainnetBroadcastAllowed: false,
    });
  }
  if (!comparison.agree) {
    return Object.freeze({
      status: comparison.reason === 'BLOCK_HASH_MISMATCH' ? 'PROVIDER_DISAGREEMENT' : 'COMMON_BLOCK_UNAVAILABLE',
      providersAgree: false,
      providerResults: Object.freeze([
        { provider: 'alchemy', status: 'HEAD_READ_OK', blockNumber: headA.blockNumber.toString() },
        { provider: 'pinax', status: 'HEAD_READ_OK', blockNumber: headB.blockNumber.toString() },
      ]),
      commonBlock: comparison.blockNumber?.toString() ?? null,
      mainnetBroadcastAllowed: false,
    });
  }
  return Object.freeze({
    status: 'HEADS_AGREE_ONLY',
    providersAgree: true,
    providerResults: Object.freeze([
      { provider: 'alchemy', status: 'HEAD_READ_OK', blockNumber: headA.blockNumber.toString() },
      { provider: 'pinax', status: 'HEAD_READ_OK', blockNumber: headB.blockNumber.toString() },
    ]),
    commonBlock: comparison.blockNumber.toString(),
    commonBlockHash: comparison.blockHash,
    mainnetBroadcastAllowed: false,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const network = process.argv[2] ?? 'mainnet';
  const mainnet = network === 'mainnet';
  const testnet = network === 'testnet';
  if (!mainnet && !testnet) throw new Error('Pass mainnet or testnet');
  const suffix = mainnet ? 'MAINNET' : 'TESTNET';
  const networkType = mainnet ? 'mainnet' : 'testnet';
  const primaryEndpoint = process.env[`RH_${suffix}_RPC_PRIMARY`];
  const secondaryEndpoint = process.env[`RH_${suffix}_RPC_SECONDARY`];
  const expectedChainId = mainnet ? 4663 : 46630;
  const result = await collectRpcPreflight({
    expectedChainId,
    primary: primaryEndpoint ? createRpcClient({ provider: 'alchemy', networkType, endpoint: primaryEndpoint }) : null,
    secondary: secondaryEndpoint ? createRpcClient({ provider: 'pinax', networkType, endpoint: secondaryEndpoint }) : null,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'HEADS_AGREE_ONLY') process.exitCode = 2;
}
