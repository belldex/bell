export function calculateSwapBounds({ exactInput, amountIn, amountOut, slippageBps }) {
  const input = BigInt(amountIn);
  const output = BigInt(amountOut);
  if (input <= 0n || output <= 0n) throw new RangeError('swap amounts must be positive');
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new RangeError('slippage must be between 0 and 9999 basis points');
  if (exactInput) return { maxIn: input, minOut: output * BigInt(10_000 - slippageBps) / 10_000n };
  const denominator = BigInt(10_000 - slippageBps);
  const maxIn = (input * 10_000n + denominator - 1n) / denominator;
  return { maxIn, minOut: output };
}
