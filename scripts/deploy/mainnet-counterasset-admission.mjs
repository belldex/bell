import { keccak256, stringToHex } from 'viem';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;

/** Bind a reviewed, unpriced SESSION_ONLY counterasset admission to its current Mainnet code. */
export function buildReviewedSessionOnlyCounterasset({ review, chainId, onchain }) {
  if (Number(chainId) !== 4663 || Number(review?.chainId) !== 4663) {
    throw new Error('counterasset review and RPC must both be Robinhood Chain Mainnet (4663)');
  }
  if (review?.schemaVersion !== 1 || review.status !== 'ADMITTED') {
    throw new Error('counterasset review is not an admitted schema-v1 record');
  }

  const token = review.token;
  const policy = review.admissionPolicy;
  if (!ADDRESS.test(token?.address ?? '') || !ADDRESS.test(onchain?.address ?? '')
    || token.address.toLowerCase() !== onchain.address.toLowerCase()) {
    throw new Error('reviewed token address differs from the Mainnet token');
  }
  if (String(token.symbol).toUpperCase() !== String(onchain.symbol).toUpperCase()) {
    throw new Error('reviewed token symbol differs from the Mainnet token');
  }
  if (Number(token.decimals) !== Number(onchain.decimals)) {
    throw new Error('reviewed token decimals differ from the Mainnet token');
  }
  if (!BYTES32.test(token.runtimeCodeHash ?? '') || !BYTES32.test(onchain.codeHash ?? '')
    || token.runtimeCodeHash.toLowerCase() !== onchain.codeHash.toLowerCase()) {
    throw new Error('reviewed token runtime code hash differs from the Mainnet token');
  }
  if (policy?.isStock !== false || Number(policy.capabilityMask) !== 0
    || policy.allowedPoolClass !== 'SESSION_ONLY' || policy.sourceConfig !== '0x'
    || policy.referenceAdapter !== null) {
    throw new Error('counterasset review must remain unpriced and SESSION_ONLY');
  }

  const address = onchain.address;
  const codeHash = onchain.codeHash.toLowerCase();
  return {
    symbol: String(onchain.symbol).toUpperCase(),
    token: address,
    decimals: Number(onchain.decimals),
    isStock: false,
    capabilityMask: 0,
    sourceConfig: '0x',
    adapters: {},
    evidenceHash: keccak256(stringToHex('BELL_SESSION_ONLY_COUNTERASSET:' + address.toLowerCase() + ':' + codeHash)),
  };
}
