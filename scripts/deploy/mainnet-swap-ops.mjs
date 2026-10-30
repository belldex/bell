export function validateMainnetSwapPreflight({
  poolLive,
  canSwap,
  reasonBits,
  inputBalance,
  amount,
  remainingGross,
  rollingRemaining,
  minAmountOut,
  nativeBalance,
  useNativeInput,
  policyMode,
}) {
  if (!poolLive) throw new Error('pool is not live');
  const oracleRecoveryReasons = (1n << 8n) | (1n << 9n) | (1n << 12n);
  if ((BigInt(reasonBits) & oracleRecoveryReasons) !== 0n || Number(policyMode) === 3) {
    throw new Error('pool has stale oracle inputs or is recovering; run mainnet-prepare-oracles.mjs with --stock, --counterasset and --hook first. A stale pool needs a second prepare at least 60 seconds later with a new quote and advanced observation; a reverting swap cannot persist recovery');
  }
  if (!canSwap || BigInt(reasonBits) !== 0n) throw new Error(`pool is halted or has blocking reasons ${reasonBits}`);
  if (typeof amount !== 'bigint' || amount <= 0n) throw new Error('amount must be a positive bigint');
  if (typeof minAmountOut !== 'bigint' || minAmountOut <= 0n) throw new Error('minAmountOut must be a positive bigint');
  if (amount > remainingGross || amount > rollingRemaining) throw new Error('amount exceeds current gross or rolling budget');
  if (useNativeInput && inputBalance < 0n) throw new Error('native-input token balance invariant is invalid');
  if (!useNativeInput && inputBalance < amount) throw new Error('insufficient input token balance');
  if (useNativeInput && nativeBalance < amount) throw new Error('insufficient native ETH for WETH input');
  return true;
}

export function validateSwapBroadcastAuthorization({ broadcast, authorized, pairLabel, amount, minAmountOut }) {
  if (!broadcast) return false;
  if (!authorized) throw new Error('broadcast blocked: explicit --i-authorize-spend is required');
  if (!pairLabel || typeof amount !== 'bigint' || amount <= 0n || typeof minAmountOut !== 'bigint' || minAmountOut <= 0n) {
    throw new Error('broadcast requires a selected pool pair, positive input and explicit minimum output');
  }
  return true;
}
