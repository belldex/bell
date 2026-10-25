import { formatUnits } from 'viem';

/** Format a raw decimal-string amount with token decimals, grouped and trimmed. */
export function formatRaw(raw: string, decimals: number, maxFraction = 4): string {
  const text = formatUnits(BigInt(raw), decimals);
  const [whole, frac = ''] = text.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = frac.slice(0, maxFraction).replace(/0+$/, '');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** used / total as 0..1 using bigint-safe math (no Number overflow). */
export function ratio(used: string, total: string): number {
  const t = BigInt(total);
  if (t === 0n) return 0;
  return Number((BigInt(used) * 10_000n) / t) / 10_000;
}

export function remaining(used: string, total: string): string {
  const r = BigInt(total) - BigInt(used);
  return String(r < 0n ? 0n : r);
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
