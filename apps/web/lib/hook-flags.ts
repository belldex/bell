/* Pure hook-permission logic, shared by scripts/verify-exit-liveness.ts and the /proof page, so the script and the
   page can never disagree. No imports, no environment: it runs in Node and in the browser. */

export const HOOK_FLAG_MASK = 0x3fffn;
export const EXPECTED_BELL_FLAGS = 0x2cc0;

/* bit -> name, in the order of the Uniswap v4 Hooks library */
export const PERMISSION_BITS: { bit: number; name: string; exit: boolean }[] = [
  { bit: 13, name: "beforeInitialize", exit: false },
  { bit: 12, name: "afterInitialize", exit: false },
  { bit: 11, name: "beforeAddLiquidity", exit: false },
  { bit: 10, name: "afterAddLiquidity", exit: false },
  { bit: 9, name: "beforeRemoveLiquidity", exit: true },
  { bit: 8, name: "afterRemoveLiquidity", exit: true },
  { bit: 7, name: "beforeSwap", exit: false },
  { bit: 6, name: "afterSwap", exit: false },
  { bit: 5, name: "beforeDonate", exit: false },
  { bit: 4, name: "afterDonate", exit: false },
  { bit: 3, name: "beforeSwapReturnDelta", exit: false },
  { bit: 2, name: "afterSwapReturnDelta", exit: false },
  { bit: 1, name: "afterAddLiquidityReturnDelta", exit: false },
  { bit: 0, name: "afterRemoveLiquidityReturnDelta", exit: true },
];

export type HookCheck = {
  hook: string;
  flags: number;
  flagsHex: string;
  set: string[];
  /** the exit-related permissions that are switched on; empty means exit cannot be touched by the hook */
  exitSet: string[];
  pass: boolean;
};

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function flagsOf(address: string): number {
  if (!isAddress(address)) throw new Error(`not an address: ${address}`);
  return Number(BigInt(address) & HOOK_FLAG_MASK);
}

export function checkHook(address: string): HookCheck {
  const flags = flagsOf(address);
  const set = PERMISSION_BITS.filter((p) => (flags >> p.bit) & 1).map((p) => p.name);
  const exitSet = PERMISSION_BITS.filter((p) => p.exit && (flags >> p.bit) & 1).map((p) => p.name);
  return { hook: address, flags, flagsHex: "0x" + flags.toString(16).padStart(4, "0"), set, exitSet, pass: exitSet.length === 0 };
}
