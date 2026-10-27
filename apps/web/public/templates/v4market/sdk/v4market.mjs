// v4 Marketplace SDK. One ES module, no dependency. Import it from the site that serves it:
//   import * as v4market from "https://v4market.com/sdk/v4market.mjs";
// Reads go through the site's MCP endpoint, which reads the chain (Robinhood Chain, 4663).

const BASE = new URL(".", import.meta.url).href.replace(/\/sdk\/$/, "");
export const CHAIN_ID = 4663;
export const DYNAMIC_FEE = 0x800000;
export const TICK_SPACING = 60;
export const STACK_GAS_BUDGET = 400000;
export const STACK_ROYALTY_CAP_BPS = 30;
export const AFTER_SWAP_GAS = 40000;

let _id = 0;
async function mcp(name, args = {}) {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++_id, method: "tools/call", params: { name, arguments: args } }),
  });
  const j = await r.json();
  const res = j.result;
  if (!res || res.isError) throw new Error(res?.content?.[0]?.text || j.error?.message || "v4market: call failed");
  return JSON.parse(res.content[0].text);
}

/** Sorts a pair the way a v4 pool key wants it. */
export function sortPair(a, b) {
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

/** A v4 Marketplace pool key: sorted pair, dynamic fee, the hook stack as the hook (its address is in createPool's answer). */
export function poolKey(tokenA, tokenB, hookStack) {
  const [currency0, currency1] = sortPair(tokenA, tokenB);
  return { currency0, currency1, fee: DYNAMIC_FEE, tickSpacing: TICK_SPACING, hooks: hookStack };
}

/** sqrtPriceX96 for `price` = whole currency1 per whole currency0. */
export function sqrtPriceX96(price, dec0, dec1) {
  const num = BigInt(Math.round(price * 1e18)) * 10n ** BigInt(dec1) * (1n << 192n);
  const den = 10n ** 18n * 10n ** BigInt(dec0);
  let n = num / den, x = BigInt(Math.floor(Math.sqrt(Number(n)))) || 1n;
  for (let i = 0; i < 80; i++) { const y = (x + n / x) >> 1n; if (y === x || y === x + 1n) break; x = y; }
  while (x * x > n) x--;
  return x;
}

/** Every listed v4 hook with gas, royalty, pools, swaps, failed runs and stake. */
export const listHooks = () => mcp("list_hooks");

/** Gas and royalty of a hook stack, checked against the budget, from the listed v4 hooks. */
export async function quoteStack(hookIds) {
  const hooks = await listHooks();
  const picked = hookIds.map((id) => hooks.find((h) => h.id === id));
  if (picked.some((h) => !h)) throw new Error("v4market: unknown hook id");
  const gas = picked.reduce((g, h) => g + h.gasLimit + (h.afterSwap ? AFTER_SWAP_GAS : 0), 0);
  const royaltyBps = picked.reduce((r, h) => r + h.royaltyBps, 0);
  return { gas, royaltyBps, fits: gas <= STACK_GAS_BUDGET && royaltyBps <= STACK_ROYALTY_CAP_BPS && hookIds.length <= 5, inactive: picked.filter((h) => !h.active).map((h) => h.id) };
}

/** Live answer of each v4 hook for a swap on a pair, composed the way the hook stack does it. */
export const quoteLive = (tokenA, tokenB, hookIds, opts = {}) => mcp("quote_stack", { tokenA, tokenB, hookIds, ...opts });

/** Calldata to create a v4 Marketplace pool (Dam.createDam on chain). `configs` are hex bytes per hook ("0x" for none). */
export const encodeCreatePool = (tokenA, tokenB, sqrtPrice, hookIds, configs, baseFeePips = 3000) =>
  mcp("create_pool", { tokenA, tokenB, sqrtPriceX96: sqrtPrice.toString(), hookIds, configs, baseFeePips });

/** Pools, swaps, royalties and failed runs, overall or for one v4 hook. */
export const hookStats = (hookId) => mcp("hook_stats", hookId ? { hookId } : {});

// Names from before the plain-words pass, kept so existing scripts run.
export const listLogs = listHooks;
export const quoteDam = quoteLive;
export const encodeCreateDam = encodeCreatePool;
export const logStats = hookStats;

/** The paid simulator: returns the 402 requirements to sign an EIP-3009 USDG authorization against. */
export const simulatorRequirements = () => fetch(`${BASE}/api/simulate`).then((r) => r.json());

/** Calls the simulator with a signed X-PAYMENT header (base64 JSON of the authorization and signature). */
export const simulate = (input, xPayment) =>
  fetch(`${BASE}/api/simulate`, { method: "POST", headers: { "content-type": "application/json", "x-payment": xPayment }, body: JSON.stringify(input) }).then((r) => r.json());
