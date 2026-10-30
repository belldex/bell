import { formatEther } from 'viem';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * @param {{
 *   chainId: number,
 *   expectedChainId: number,
 *   tokenA: string,
 *   tokenB: string,
 *   assetA: string,
 *   assetB: string,
 *   referenceAdapterA?: string,
 *   referenceAdapterB?: string,
 *   poolClass: number,
 *   now: number,
 *   stockHealth: Array<{ ready: boolean; reasonBits: bigint | number; validUntil: bigint | number }>,
 *   stockCount: number,
 *   activationPending: boolean,
 *   tokenABalance: bigint,
 *   tokenBBalance: bigint,
 *   amountMaxA: bigint,
 *   amountMaxB: bigint,
 *   weth: string,
 *   nativeBalance: bigint,
 *   nativeGasReserve: bigint,
 *   estimatedGasWei?: bigint,
 *   gasReserve?: bigint,
 *   feeToken: string,
 *   feeBalance: bigint,
 *   serviceFee: bigint,
 *   pairLabel: string,
 *   decimalsA: number,
 *   decimalsB: number,
 *   balanceAFeeAliased?: boolean,
 *   balanceBFeeAliased?: boolean,
 * }} input
 */
export function buildCreatePoolPreflight(input) {
  if (input.chainId !== input.expectedChainId) throw new Error(`wrong chain ${input.chainId}; expected ${input.expectedChainId}`);
  if (input.tokenA.toLowerCase() === input.tokenB.toLowerCase()) throw new Error('pool pair tokens must be distinct');
  if (input.poolClass === 0) {
    if (!input.referenceAdapterA || !input.referenceAdapterB
      || input.referenceAdapterA === ZERO_ADDRESS || input.referenceAdapterB === ZERO_ADDRESS) {
      throw new Error('PRICE_GUARDED requires a nonzero independent reference for both assets');
    }
  } else if (input.poolClass === 1) {
    if ((input.referenceAdapterA && input.referenceAdapterA !== ZERO_ADDRESS)
      || (input.referenceAdapterB && input.referenceAdapterB !== ZERO_ADDRESS)) {
      throw new Error('SESSION_ONLY cannot claim price-reference protection');
    }
  } else {
    throw new Error(`unsupported pool class ${input.poolClass}`);
  }
  if (input.stockCount < 1) throw new Error('BELL pool requires at least one admitted stock');
  if (input.poolClass === 1 && input.stockCount !== 1) throw new Error('SESSION_ONLY requires exactly one stock asset');
  if (input.activationPending) throw new Error('asset activation is pending');
  if (input.stockHealth.length !== input.stockCount) throw new Error('missing health record for a stock asset');
  for (const [i, health] of input.stockHealth.entries()) {
    if (!health.ready || BigInt(health.reasonBits) !== 0n || BigInt(health.validUntil) <= BigInt(input.now)) {
      throw new Error(`stock ${i + 1} health is not fresh and ready`);
    }
  }
  for (const [name, value] of Object.entries({
    tokenABalance: input.tokenABalance, tokenBBalance: input.tokenBBalance,
    nativeBalance: input.nativeBalance, nativeGasReserve: input.nativeGasReserve,
    feeBalance: input.feeBalance, serviceFee: input.serviceFee,
  })) {
    if (typeof value !== 'bigint' || value < 0n) throw new TypeError(`${name} must be a non-negative bigint`);
  }
  const estimatedGasWei = input.estimatedGasWei ?? 0n;
  const gasReserve = input.gasReserve ?? 0n;
  if (estimatedGasWei < 0n || gasReserve < 0n) throw new TypeError('estimatedGasWei and gasReserve must be non-negative bigints');
  if (input.decimalsA < 0 || input.decimalsA > 18 || input.decimalsB < 0 || input.decimalsB > 18) {
    throw new Error('token decimals must be in [0,18]');
  }
  const wethA = input.tokenA.toLowerCase() === input.weth.toLowerCase();
  const wethB = input.tokenB.toLowerCase() === input.weth.toLowerCase();
  const seedA = input.amountMaxA ?? input.amountAMax;
  const seedB = input.amountMaxB ?? input.amountBMax;
  if (typeof seedA !== 'bigint' || seedA <= 0n || typeof seedB !== 'bigint' || seedB <= 0n) {
    throw new Error('both canonical pool seed amounts must be positive');
  }
  const nativeToWrap = wethA ? max0(seedA - input.tokenABalance)
    : wethB ? max0(seedB - input.tokenBBalance) : 0n;
  const shortfalls = [];
  if (!wethA && !input.balanceAFeeAliased && input.tokenABalance < seedA) {
    shortfalls.push(`token A balance ${input.tokenABalance} < seed ${seedA}`);
  }
  if (!wethB && !input.balanceBFeeAliased && input.tokenBBalance < seedB) {
    shortfalls.push(`token B balance ${input.tokenBBalance} < seed ${seedB}`);
  }
  if (nativeToWrap > 0n && input.nativeBalance < nativeToWrap) {
    shortfalls.push(`native ETH ${formatEther(input.nativeBalance)} < WETH wrap ${formatEther(nativeToWrap)}`);
  }
  if (nativeToWrap > 0n && input.nativeBalance - nativeToWrap < input.nativeGasReserve) {
    shortfalls.push(`native ETH after WETH wrap ${formatEther(max0(input.nativeBalance - nativeToWrap))} < reserve ${formatEther(input.nativeGasReserve)}`);
  }
  if (input.nativeBalance - nativeToWrap < estimatedGasWei + gasReserve) {
    shortfalls.push(`native ETH after WETH wrap ${formatEther(max0(input.nativeBalance - nativeToWrap))} < estimated create gas ${formatEther(estimatedGasWei)} + reserve ${formatEther(gasReserve)}`);
  }
  const feeSeed = input.tokenA.toLowerCase() === input.feeToken.toLowerCase() ? seedA
    : input.tokenB.toLowerCase() === input.feeToken.toLowerCase() ? seedB : 0n;
  if (feeSeed > 0n) {
    const seedBalance = input.tokenA.toLowerCase() === input.feeToken.toLowerCase() ? input.tokenABalance : input.tokenBBalance;
    if (seedBalance < feeSeed) shortfalls.push(`fee token seed balance ${seedBalance} < ${feeSeed}`);
  }
  if (input.feeBalance < input.serviceFee + feeSeed) shortfalls.push(`fee token ${input.feeBalance} < service fee ${input.serviceFee} + seed ${feeSeed}`);
  if (shortfalls.length) throw new Error(`insufficient seed/gas funding for ${input.pairLabel}: ${shortfalls.join('; ')}`);
  return Object.freeze({
    chainId: input.chainId,
    pair: input.pairLabel,
    poolClass: input.poolClass,
    stockCount: input.stockCount,
  amountMax: Object.freeze([seedA, seedB]),
    nativeToWrap,
    serviceFee: input.serviceFee,
    estimatedGasWei,
    gasReserve,
  });
}

export function validateCreatePoolBroadcastAuthorization({ broadcast, authorized, pairLabel, amountMax }) {
  if (!broadcast) return false;
  if (!authorized) throw new Error('broadcast blocked: explicit --i-authorize-spend is required');
  if (!pairLabel || !Array.isArray(amountMax) || amountMax.length !== 2) {
    throw new Error('broadcast requires explicit pair identity and both seed amounts');
  }
  if (amountMax.some((amount) => typeof amount !== 'bigint' || amount <= 0n)) {
    throw new Error('broadcast requires positive explicit seed amounts');
  }
  return true;
}

function max0(value) { return value > 0n ? value : 0n; }
