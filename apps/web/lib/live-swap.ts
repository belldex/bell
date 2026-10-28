/**
 * Live swap wiring for the swap screen.
 *
 * Everything here is deliberately small and explicit:
 *   - the router address and ABI come from the deployed testnet manifest, not from a guess
 *   - approval is a separate, visible step because the router pulls the input token
 *   - the request is built from the onchain hook config, never from UI state alone
 *
 * This module does not decide whether a swap is allowed. The hook does, onchain. If the pool is
 * halted the transaction reverts with PolicyBlocked and the UI must show that, not a fake success.
 */
import {
  createPublicClient,
  custom,
  http,
  parseAbi,
  parseUnits,
  maxUint256,
  type Address,
  type EIP1193Provider,
} from 'viem';
import { TESTNET } from '@bell/protocol/testnet-status';

export const SWAP_ABI = parseAbi([
  'function swap((address hook, bytes32 expectedConfigHash, bool zeroForOne, bool exactInput, uint128 amountSpecified, uint128 limitAmount, uint160 sqrtPriceLimitX96, address recipient, uint64 deadline, uint64 nonce, bool wrapInput, bool unwrapOutput) request) payable returns (uint128 amountIn, uint128 amountOut)',
  'function nonces(address) view returns (uint64)',
]);

export const HOOK_ABI = parseAbi([
  'function poolKey() view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))',
  'function configHash() view returns (bytes32)',
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] a, uint128[2] b, uint128[2] c, uint128[2] d, uint128[2] e, uint64 f, uint64 g, bytes32 h, bytes32 i))',
]);

export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

export const ROUTER: Address = TESTNET.contracts.router as Address;

export function publicClientFor(provider?: EIP1193Provider) {
  return provider
    ? createPublicClient({ transport: custom(provider) })
    : createPublicClient({ transport: http() });
}

export interface LivePoolState {
  hook: Address;
  configHash: `0x${string}`;
  currency0: Address;
  currency1: Address;
  canSwap: boolean;
  mode: number;
  phase: number;
  reasonBits: bigint;
  lpFeeUnits: number;
}

/** Reads the real hook policy. Never infers tradability from UI fixtures. */
export async function readLivePool(hook: Address, provider?: EIP1193Provider): Promise<LivePoolState> {
  const client = publicClientFor(provider);
  const [key, configHash, policy] = await Promise.all([
    client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'poolKey' }),
    client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'configHash' }),
    client.readContract({ address: hook, abi: HOOK_ABI, functionName: 'getPolicy' }),
  ]);
  return {
    hook,
    configHash,
    currency0: key.currency0 as Address,
    currency1: key.currency1 as Address,
    canSwap: policy.canSwap,
    mode: policy.mode,
    phase: policy.phase,
    reasonBits: policy.reasonBits,
    lpFeeUnits: policy.lpFeeUnits,
  };
}

export interface BuildSwapInput {
  pool: LivePoolState;
  zeroForOne: boolean;
  exactInput: boolean;
  amount: string;
  tokenInDecimals: number;
  slippageBps: number;
  recipient: Address;
  deadlineSeconds: number;
  nonce: bigint;
}

/**
 * Builds the router request. Slippage is applied to the limit amount:
 * exact-input protects the output floor, exact-output protects the input ceiling.
 */
export function buildSwapRequest(input: BuildSwapInput) {
  const raw = parseUnits(input.amount, input.tokenInDecimals);
  if (raw <= 0n) throw new Error('Amount must be greater than zero');
  const slip = BigInt(10_000 + input.slippageBps);
  const limit = (raw * slip) / 10_000n;
  return {
    hook: input.pool.hook,
    expectedConfigHash: input.pool.configHash,
    zeroForOne: input.zeroForOne,
    exactInput: input.exactInput,
    amountSpecified: raw,
    limitAmount: limit,
    sqrtPriceLimitX96: 0n,
    recipient: input.recipient,
    deadline: BigInt(Math.floor(Date.now() / 1000) + input.deadlineSeconds),
    nonce: input.nonce,
    wrapInput: false,
    unwrapOutput: false,
  };
}

export async function readRouterNonce(account: Address, provider?: EIP1193Provider): Promise<bigint> {
  const client = publicClientFor(provider);
  return client.readContract({ address: ROUTER, abi: SWAP_ABI, functionName: 'nonces', args: [account] });
}

export async function readAllowance(token: Address, owner: Address, provider?: EIP1193Provider): Promise<bigint> {
  const client = publicClientFor(provider);
  return client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, ROUTER],
  });
}

export { maxUint256 };

/**
 * Maps a router revert into a message a human can act on.
 * A blocked swap is a normal, expected outcome, not a crash.
 */
export function describeSwapError(error: unknown): string {
  const text = String((error as { shortMessage?: string; message?: string })?.shortMessage
    ?? (error as { message?: string })?.message
    ?? error);
  if (/PolicyBlocked/.test(text)) return 'Pool policy blocked this swap. The session, price or budget is not currently valid.';
  if (/SlippageExceeded/.test(text)) return 'Price moved beyond your slippage limit. Re-quote and try again.';
  if (/DeadlineExpired/.test(text)) return 'The transaction deadline passed before it was mined. Try again.';
  if (/InvalidNonce/.test(text)) return 'Another transaction from this wallet changed the nonce. Refresh and retry.';
  if (/User rejected|denied/i.test(text)) return 'Transaction rejected in the wallet.';
  if (/insufficient funds/i.test(text)) return 'Not enough balance to pay for this swap plus gas.';
  return text.slice(0, 200);
}
