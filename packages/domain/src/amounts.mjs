export const MAX_UINT128 = (1n << 128n) - 1n;

function assertDecimals(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError('decimals must be an integer from 0 through 18');
  }
}

export function parseUnits(value, decimals) {
  assertDecimals(decimals);
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/.test(value)) {
    throw new TypeError('amount must be a canonical non-negative decimal string');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new RangeError('amount has more fractional digits than token decimals');
  const scale = 10n ** BigInt(decimals);
  const fractionalUnits = fraction.length === 0 ? 0n : BigInt(fraction.padEnd(decimals, '0'));
  const amount = BigInt(whole) * scale + fractionalUnits;
  if (amount > MAX_UINT128) throw new RangeError('amount exceeds the supported uint128 domain');
  return amount;
}

export function formatUnits(value, decimals) {
  assertDecimals(decimals);
  let amount;
  if (typeof value === 'bigint') amount = value;
  else if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) amount = BigInt(value);
  else throw new TypeError('raw amount must be a bigint or canonical integer string');
  if (amount < 0n || amount > MAX_UINT128) throw new RangeError('raw amount is outside the supported uint128 domain');
  if (decimals === 0) return amount.toString();

  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
