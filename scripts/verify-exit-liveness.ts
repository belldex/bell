#!/usr/bin/env node
/* BELL exit liveness check.

   A Uniswap v4 hook's permissions are the low 14 bits of its own address. The PoolManager calls a hook callback only
   when that bit is set, so a hook whose "remove liquidity" bits are clear cannot be called while liquidity is removed.
   This script reads every BELL hook address and proves that from the address alone, with no trust in the source.

     node scripts/verify-exit-liveness.ts                       every pool from the BELL keeper
     node scripts/verify-exit-liveness.ts --snapshot            the committed list, no network
     node scripts/verify-exit-liveness.ts --hook 0x...          one or more addresses you name
     node scripts/verify-exit-liveness.ts --rpc <url>           also check code exists and getHookPermissions() agrees
     node scripts/verify-exit-liveness.ts --write               refresh the committed list (keeper only)
     node scripts/verify-exit-liveness.ts --json                machine readable output

   Exit code: 0 all PASS, 1 any FAIL (or no hooks), 2 a source could not be read. Needs Node 24 (runs TypeScript
   directly); --rpc also needs viem, which the workspace already has. */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXPECTED_BELL_FLAGS, HOOK_FLAG_MASK, PERMISSION_BITS, checkHook, flagsOf, isAddress } from "../apps/web/lib/hook-flags.ts";
import type { HookCheck } from "../apps/web/lib/hook-flags.ts";

export { EXPECTED_BELL_FLAGS, HOOK_FLAG_MASK, PERMISSION_BITS, checkHook, flagsOf, isAddress };
export type { HookCheck };

export const KEEPER_URL = "https://bell-keeper-b.asysyifaq25.workers.dev";
export const SNAPSHOT_PATH = new URL("../apps/web/content/exit-proof.json", import.meta.url);

export type Row = HookCheck & { label: string; poolId?: string; note?: string };

export function renderTable(rows: Row[]): string {
  const head = ["pool", "hook", "flags", "exit bits", "status"];
  const body = rows.map((r) => [r.label, r.hook, r.flagsHex, r.exitSet.length ? r.exitSet.join(",") : "none", r.pass ? "PASS" : "FAIL"]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

/* token addresses (lower case) that appear in BELL pools, so a row reads "TSLA / USDG" and not two hex strings */
const SYMBOLS: Record<string, string> = {
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168": "USDG",
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": "AAPL",
  "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec": "NVDA",
  "0x322f0929c4625ed5bad873c95208d54e1c003b2d": "TSLA",
};
const symbol = (a: string) => SYMBOLS[a.toLowerCase()] ?? a.slice(0, 8);

export type KeeperPool = { hook: string; poolId: string; token0: string; token1: string; configHash?: string; poolClass?: number | string };

export function labelOf(p: KeeperPool): string {
  const a = symbol(p.token0);
  const b = symbol(p.token1);
  return a === "USDG" ? `${b} / ${a}` : `${a} / ${b}`;
}

export async function readKeeper(url = KEEPER_URL): Promise<KeeperPool[]> {
  const res = await fetch(`${url.replace(/\/$/, "")}/pools`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`keeper /pools answered ${res.status}`);
  const body = (await res.json()) as { pools?: KeeperPool[] };
  if (!Array.isArray(body.pools)) throw new Error("keeper /pools has no pools array");
  return body.pools;
}

/* optional: the hook has code, and the permissions it reports about itself agree with the address bits */
export async function crossCheckOnchain(rpc: string, rows: Row[]): Promise<void> {
  const { createPublicClient, http, parseAbi } = await import("viem");
  const client = createPublicClient({ transport: http(rpc) });
  const abi = parseAbi([
    "function getHookPermissions() view returns ((bool beforeInitialize,bool afterInitialize,bool beforeAddLiquidity,bool afterAddLiquidity,bool beforeRemoveLiquidity,bool afterRemoveLiquidity,bool beforeSwap,bool afterSwap,bool beforeDonate,bool afterDonate,bool beforeSwapReturnDelta,bool afterSwapReturnDelta,bool afterAddLiquidityReturnDelta,bool afterRemoveLiquidityReturnDelta))",
  ]);
  for (const row of rows) {
    const code = await client.getCode({ address: row.hook as `0x${string}` });
    if (!code || code === "0x") {
      row.pass = false;
      row.note = "no code at this address";
      continue;
    }
    try {
      const perms = (await client.readContract({ address: row.hook as `0x${string}`, abi, functionName: "getHookPermissions" })) as Record<string, boolean>;
      const reported = Object.entries(perms).filter(([, on]) => on).map(([name]) => name).sort();
      const fromAddress = [...row.set].sort();
      if (JSON.stringify(reported) !== JSON.stringify(fromAddress)) {
        row.pass = false;
        row.note = `getHookPermissions() says ${reported.join(",")}`;
      } else row.note = "code present, getHookPermissions() agrees";
    } catch {
      row.note = "code present; getHookPermissions() not readable";
    }
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(name);

async function main() {
  let rows: Row[] = [];
  const named = process.argv.flatMap((v, i) => (process.argv[i - 1] === "--hook" ? [v] : []));
  try {
    if (named.length) {
      rows = named.map((h) => ({ ...checkHook(h), label: "named" }));
    } else if (has("--snapshot")) {
      const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as { hooks: { pair: string; hook: string; poolId: string }[] };
      rows = snap.hooks.map((h) => ({ ...checkHook(h.hook), label: h.pair, poolId: h.poolId }));
    } else {
      const pools = await readKeeper(arg("--keeper"));
      rows = pools.map((p) => ({ ...checkHook(p.hook), label: labelOf(p), poolId: p.poolId }));
      if (has("--write")) {
        const prev = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
        const next = {
          ...prev,
          generatedAt: new Date().toISOString(),
          hooks: pools.map((p) => ({ pair: labelOf(p), poolId: p.poolId, hook: p.hook, flags: checkHook(p.hook).flagsHex, configHash: p.configHash ?? null, poolClass: Number(p.poolClass ?? 0) })),
        };
        writeFileSync(SNAPSHOT_PATH, JSON.stringify(next, null, 2) + "\n");
        console.error(`wrote ${pools.length} hooks to apps/web/content/exit-proof.json`);
      }
    }
  } catch (error) {
    console.error(`could not read hooks: ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }

  if (arg("--rpc")) await crossCheckOnchain(arg("--rpc") as string, rows);

  const failed = rows.filter((r) => !r.pass);
  if (has("--json")) console.log(JSON.stringify({ checked: rows.length, failed: failed.length, rows }, null, 2));
  else {
    console.log(renderTable(rows));
    for (const r of rows) if (r.note) console.log(`  ${r.label} ${r.hook}: ${r.note}`);
    const bell = rows.filter((r) => r.flags === EXPECTED_BELL_FLAGS).length;
    console.log(`\n${rows.length} hooks, ${rows.length - failed.length} PASS, ${failed.length} FAIL. ${bell} carry the BELL mask 0x2cc0.`);
  }
  process.exitCode = rows.length === 0 || failed.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
