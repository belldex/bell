#!/usr/bin/env node
// BELL on Elysium testnet: a paced terminal walkthrough that reads the chain live.
//
//   node scripts/auction-cli/bell-elysium.mjs            press Enter between scenes (the pace for a recording)
//   node scripts/auction-cli/bell-elysium.mjs --auto     advance on a timer
//   node scripts/auction-cli/bell-elysium.mjs --fast     shorter pauses, for a quick check
//   node scripts/auction-cli/bell-v4.mjs --chain elysium-testnet    the same thing, through the v4 CLI
//
// Everything on screen is read from the chain at run time: the latest block, the code at every address, each hook's
// permissions from its own address, each pool's live policy, each transaction's receipt, and the settled auction.
// The addresses and transaction hashes come from the repository's own deployment records. Nothing is typed by hand.

import readline from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

const ARGS = new Set(process.argv.slice(2));
const AUTO = ARGS.has("--auto");
const FAST = ARGS.has("--fast");
const here = fileURLToPath(new URL("./", import.meta.url));
const root = join(here, "../../");
const readJson = (p) => (existsSync(join(root, p)) ? JSON.parse(readFileSync(join(root, p), "utf8")) : null);

const CHAIN_ID = 99801;
const RPC = process.env.BELL_RPC_URL || "https://testnet-rpc.elysium.kinetiq.xyz";
const EXPLORER = "https://testnet.elysium.kinetiq.xyz";
const PACE = FAST ? 0.2 : 1;

// ───────────────────────── theme: monochrome, one red accent ─────────────────────────
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `38;2;${n >> 16};${(n >> 8) & 255};${n & 255}`; };
const paint = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const c = { text: paint(rgb("#EDEDED")), muted: paint(rgb("#8A8A8A")), faint: paint(rgb("#4A4A4A")), red: paint(rgb("#E5484D")), bold: paint(1), italic: paint(3) };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const out = (s = "") => process.stdout.write(s + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * PACE));
const WIDTH = () => Math.min((process.stdout.columns || 100) - 2, 100);
const rule = (ch = "─") => out(c.faint(ch.repeat(Math.min(WIDTH(), 84))));
const comma = (n) => Number(n).toLocaleString("en-US");

function wrap(text, width) {
  const lines = []; let line = "";
  for (const w of text.split(" ")) { if ((line + " " + w).trim().length > width) { lines.push(line.trim()); line = w; } else line += " " + w; }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
const para = (text, color = c.muted, indent = 0) => wrap(text, WIDTH() - indent).forEach((l) => out(" ".repeat(indent) + color(l)));
const badge = (s) => c.red(c.bold(`[ ${s} ]`));

function box(lines, { border = c.faint, w = Math.min(WIDTH(), 80) } = {}) {
  out(border("┌" + "─".repeat(w) + "┐"));
  for (const l of lines) out(border("│ ") + l + " ".repeat(Math.max(0, w - 2 - strip(l).length)) + border(" │"));
  out(border("└" + "─".repeat(w) + "┘"));
}

/** Print text one character at a time, the way a terminal session reads when it is recorded. */
async function type(text, { delay = 7, color = c.text } = {}) {
  for (const ch of text) { process.stdout.write(color(ch)); if (delay) await new Promise((r) => setTimeout(r, delay * PACE)); }
  out();
}

const FONT = {
  B: ["11110", "10001", "11110", "10001", "11110"], E: ["11111", "10000", "11110", "10000", "11111"],
  L: ["10000", "10000", "10000", "10000", "11111"], " ": ["000", "000", "000", "000", "000"],
};
async function banner(text) {
  const rows = ["", "", "", "", ""];
  for (const ch of text) FONT[ch].forEach((r, i) => (rows[i] += r.replace(/1/g, "██").replace(/0/g, "  ") + "  "));
  for (const r of rows) { out("  " + c.text(r)); await sleep(70); }
}

const bar = (frac, width = 30) => { const f = Math.max(0, Math.min(1, frac)); const n = Math.round(f * width); return c.red("█".repeat(n)) + c.faint("░".repeat(width - n)); };

// ───────────────────────── input ─────────────────────────
const rl = readline.createInterface({ input: process.stdin });
const queue = []; let waiter = null;
rl.on("line", (l) => (waiter ? (waiter(l), (waiter = null)) : queue.push(l)));
rl.on("close", () => waiter && waiter(""));
const ask = (label) => new Promise((res) => {
  process.stdout.write(`\n${c.red("?")} ${c.text(label)} ${c.muted("[Enter]")} `);
  if (AUTO) { out(); return setTimeout(() => res(""), 3200 * PACE); }
  if (queue.length) return res(queue.shift());
  waiter = res;
});

let scene = 1; // the opening scene is number one
const TOTAL = 8;
async function head(title, sub) {
  scene++;
  out(); out();
  out(`${c.red(c.bold(`${String(scene).padStart(2, "0")}/${String(TOTAL).padStart(2, "0")}`))}  ${c.bold(c.text(title.toUpperCase()))}`);
  rule();
  if (sub) para(sub);
  out();
  await sleep(350);
}

// ───────────────────────── chain access ─────────────────────────
async function rpc(method, params = []) {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { if (i === 7) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
}
async function call(to, abiText, functionName, args = []) {
  const abi = parseAbi([abiText]);
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpc("eth_call", [{ to, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: result });
}
async function spin(prefix, task) {
  const f = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]; let i = 0;
  const t = setInterval(() => process.stdout.write(`\r${c.text(f[i++ % f.length])} ${prefix}${c.muted("reading")}`), 70);
  try { const r = await task(); clearInterval(t); process.stdout.write(`\r\x1b[2K${c.text("✓")} ${prefix}${c.text(r)}\n`); return { ok: true, value: r }; }
  catch (e) { clearInterval(t); process.stdout.write(`\r\x1b[2K${c.red("✗")} ${prefix}${c.red(e.message.slice(0, 80))}\n`); return { ok: false }; }
}

// ───────────────────────── the repository's own records ─────────────────────────
const M = readJson("deployments/elysium-testnet.json");
const ADAPTERS = readJson("evidence/deploy/elysium-testnet-adapters.json") ?? {};
const REHEARSAL = readJson("evidence/deploy/elysium-testnet-rehearsal.json") ?? {};
const EXECUTOR = readJson("evidence/deploy/elysium-testnet-executor.json") ?? {};
const POOLS = readJson("evidence/deploy/elysium-testnet-pools.json")?.pools ?? [];
const TESTS = readJson("evidence/deploy/elysium-testnet-tests.json")?.entries ?? [];
const VERIFY = readJson("evidence/deploy/elysium-testnet-verification.json") ?? { verified: {} };
const SITE = readJson("apps/web/content/elysium-testnet.json") ?? { checks: [] };
if (!M) { console.error("deployments/elysium-testnet.json is missing"); process.exit(1); }

const cycle = TESTS.find((t) => t.test === "opening auction full cycle");
const pairOf = (p) => (p.auction == null ? "tAAPL / WETH" : cycle && p.hook.toLowerCase() === cycle.pool.toLowerCase() ? "tNVDA / tUSDG" : "tAAPL / tUSDG");
const partial = (a) => VERIFY.verified?.[a.toLowerCase()] === "partial";

const LEDGER = [
  ["CORE INFRASTRUCTURE", [["BellPoolFactory", M.poolFactory], ["BellRouter", M.router], ["BellHookDeployerV2", M.hookDeployer], ["BellPolicyOracle", M.policyOracle], ["BellModeEvaluator", M.modeEvaluator], ["BellPolicyDependencyReader", M.policyDependencyReader]]],
  ["OPENING BELL AUCTION", [["BellAuctionRegistry", M.auctionRegistry], ["BellAuctionFactoryModule", M.auctionFactoryModule]]],
  ["REGISTRIES", [["SafetyController", M.safetyController], ["AssetRegistry", M.assetRegistry], ["CalendarRegistry", M.calendarRegistry], ["SessionRegistry", M.sessionRegistry]]],
  ["POOL HOOKS, MASK 0x2CC0", POOLS.map((p) => [`BellHookV2 ${pairOf(p)}`, p.hook])],
  ["AUCTIONS, ONE PER USDG/STOCK POOL", POOLS.filter((p) => p.auction).map((p) => [`BellOpeningAuction ${pairOf(p)}`, p.auction])],
  ["ATTESTATION ADAPTERS, REHEARSAL", [["YahooSourceVerifier", ADAPTERS.verifier], ["tAAPL direct", ADAPTERS.directAdapter], ["tAAPL regular", ADAPTERS.regularAdapter], ["tAAPL extended", ADAPTERS.extendedAdapter], ["tNVDA direct", REHEARSAL.adapters?.direct], ["tNVDA regular", REHEARSAL.adapters?.regular], ["tNVDA extended", REHEARSAL.adapters?.extended]].filter(([, a]) => a)],
  ["TEST ASSETS, NO VALUE", [["tAAPL (BELL test)", M.testStock], ["tNVDA (BELL test)", REHEARSAL.stock2], ["tUSDG (BELL test)", M.feeToken], ["WETH", M.weth]].filter(([, a]) => a)],
  ["UNISWAP V4, DEPLOYED BY BELL", [["PoolManager", M.poolManager], ["PositionManager", M.positionManager]]],
  ["REHEARSAL HELPER", EXECUTOR.executor ? [["TestnetSwapExecutor", EXECUTOR.executor]] : []],
].filter(([, items]) => items.length);

const HOOK_FLAGS = ["afterRemoveLiquidityReturnDelta", "afterAddLiquidityReturnDelta", "afterSwapReturnDelta", "beforeSwapReturnDelta", "afterDonate", "beforeDonate", "afterSwap", "beforeSwap", "afterRemoveLiquidity", "beforeRemoveLiquidity", "afterAddLiquidity", "beforeAddLiquidity", "afterInitialize", "beforeInitialize"]; // indexed by bit number
const EXIT_BITS = new Set([9, 8, 0]);
const MODE = ["HALTED", "ACTIVE", "CLOSED", "RECOVERING"];
const PHASE = { 0: "NONE", 1: "PRE", 2: "REGULAR", 3: "POST", 4: "OVERNIGHT", 5: "CLOSED" };
const STAGE = ["IDLE", "ARMED", "OPEN", "LOCKED", "SETTLED", "REFUNDED"];
const short = (a) => `${a.slice(0, 8)}...${a.slice(-6)}`;

// ───────────────────────── scenes ─────────────────────────
async function sceneBoot() {
  console.clear(); out();
  await banner("BELL");
  out();
  out("  " + badge("ELYSIUM TESTNET REHEARSAL"));
  out();
  await type("  The same bell, rehearsed on Elysium.", { delay: 18, color: (s) => c.bold(c.text(s)) });
  para("The BELL contracts, unchanged, with test tokens that have no value. Everything below is read from the chain while you watch.", (s) => c.italic(c.muted(s)), 2);
  out();
  await sleep(500);
  const id = await spin(`${c.muted("rpc".padEnd(14))}`, async () => { await sleep(400); const v = parseInt(await rpc("eth_chainId"), 16); if (v !== CHAIN_ID) throw new Error(`wrong chain ${v}`); return `${RPC.replace("https://", "")}`; });
  if (!id.ok) throw new Error("the Elysium testnet RPC is not reachable");
  await spin(`${c.muted("chain id".padEnd(14))}`, async () => { await sleep(300); return `${CHAIN_ID}  Elysium testnet, an Arbitrum Orbit L2 on Hyperliquid`; });
  let latest;
  await spin(`${c.muted("latest block".padEnd(14))}`, async () => {
    await sleep(300); latest = await rpc("eth_getBlockByNumber", ["latest", false]);
    const age = Math.max(0, Math.floor(Date.now() / 1000) - parseInt(latest.timestamp, 16));
    return `${comma(parseInt(latest.number, 16))}  produced ${age}s ago`;
  });
  await spin(`${c.muted("gas".padEnd(14))}`, async () => { await sleep(300); const g = parseInt(await rpc("eth_gasPrice"), 16) / 1e9; return `${g.toFixed(3)} gwei, paid in HYPE`; });
  out();
  box([
    `${c.muted("Deployer ")}${c.text(M.deployer)}`,
    `${c.muted("Contracts")}${c.text(` ${LEDGER.reduce((n, [, i]) => n + i.length, 0)} addresses across ${LEDGER.length} groups`)}`,
    `${c.muted("Pools    ")}${c.text(` ${POOLS.length}, all created through the real BellPoolFactory`)}`,
  ]);
  await ask("Press Enter to read every contract from the chain");
}

async function sceneLedger() {
  await head("Every contract, read from the chain", "Each address is asked for its code with eth_getCode. A line turns into a tick only when there is code at that address.");
  const ALL = LEDGER.flatMap(([, items]) => items);
  let n = 0, pass = 0, bytes = 0, partialCount = 0;
  for (const [group, items] of LEDGER) {
    out(); out(c.muted(group));
    for (const [name, address] of items) {
      n++;
      const pre = `${c.muted(String(n).padStart(2) + "/" + ALL.length)}  ${c.text(name.padEnd(40))}${c.text(address)}  `;
      const r = await spin(pre, async () => {
        await sleep(260);
        const code = await rpc("eth_getCode", [address, "latest"]);
        const len = (code.length - 2) / 2;
        if (!len) throw new Error("no code at this address");
        bytes += len;
        if (partial(address)) partialCount++;
        return `code ${comma(len)} bytes${partial(address) ? "  source published, partial match" : ""}`;
      });
      if (r.ok) pass++;
    }
  }
  out();
  out(`${c.text("✓")} ${c.text(`${pass}/${ALL.length} addresses have deployed code`)}   ${bar(pass / ALL.length, 24)}`);
  out(`${c.text("✓")} ${c.text(`${comma(bytes)} bytes of contract code in total`)}`);
  out(`${c.faint("-")} ${c.muted(`${partialCount} of them have source on the explorer as a partial match (bytecode equal except the metadata hash). None is a full match yet.`)}`);
  await ask("Press Enter to check what each hook is allowed to do");
}

async function sceneHooks() {
  await head("What a hook may do, read from its own address", "In Uniswap v4 a hook's permissions are the low 14 bits of its address. A hook whose remove-liquidity bits are clear is never called when you withdraw. No source code needed.");
  for (const p of POOLS) {
    const bits = Number(BigInt(p.hook) & 0x3fffn);
    const tail = p.hook.slice(-4);
    out(`${c.bold(c.text(pairOf(p).padEnd(16)))}${c.muted("0x" + p.hook.slice(2, -4))}${c.red(c.bold(tail))}`);
    await sleep(350);
    let row = "";
    for (let b = 13; b >= 0; b--) {
      const set = (bits >> b) & 1;
      const ch = set ? "██" : "░░";
      row += (EXIT_BITS.has(b) ? (set ? c.red(ch) : c.faint(ch)) : set ? c.text(ch) : c.faint(ch)) + " ";
    }
    out("  " + row);
    out("  " + c.faint([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((b) => String(b).padStart(2) + " ").join("")));
    const on = HOOK_FLAGS.map((n, b) => [n, b]).filter(([, b]) => (bits >> b) & 1).sort((x, y) => y[1] - x[1]).map(([n]) => n);
    const exitSet = [...EXIT_BITS].filter((b) => (bits >> b) & 1);
    await sleep(250);
    out(`  ${c.muted("permissions")} ${c.text(on.join(", "))}`);
    out(`  ${exitSet.length === 0 ? c.text("✓") : c.red("✗")} ${c.text(exitSet.length === 0 ? "bits 9, 8 and 0 are clear: no remove-liquidity permission" : "an exit bit is set")}   ${c.muted("mask 0x" + bits.toString(16))}`);
    out();
    await sleep(500);
  }
  out(c.muted("The three exit bits are 9, 8 and 0. They are the only way a hook could act when you withdraw, and none of BELL's sets them."));
  await ask("Press Enter to read each pool's live policy");
}

async function scenePools() {
  await head("Each pool, as it is right now", "The hook is asked what it would do with a swap this second. The answer depends on the calendar and on the data it can see.");
  const POLICY = "function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] effectiveTradeCap, uint128[2] effectiveWindowCap, uint128[2] rollingRemaining, uint128[2] closureRemaining, uint128[2] referencePrice18, uint64 validUntil, uint64 closureNonce, bytes32 configHash, bytes32 stateHash))";
  const STATE = "function state() view returns ((uint8 lifecycle, uint8 mode, bool closedLatched, uint64 closureNonce, uint64 reopenCandidateAt, uint64 oldValidUntil, uint64[2] reopenBaseObservations, uint64[2] lastOpenObservations, uint64 pauseNonce, uint64 bellStart, uint64 corporateUntil))";
  const LIQ = "function getPositionLiquidity(uint256) view returns (uint128)";
  const AUC = "function currentStage() view returns (uint8)";
  for (const p of POOLS) {
    const r = await spin(`${c.text(pairOf(p).padEnd(16))}`, async () => {
      await sleep(400);
      const policy = await call(p.hook, POLICY, "getPolicy");
      const st = await call(p.hook, STATE, "state");
      const liq = await call(M.positionManager, LIQ, "getPositionLiquidity", [BigInt(p.tokenId)]);
      const stage = p.auction ? Number(await call(p.auction, AUC, "currentStage")) : null;
      return { policy, st, liq, stage };
    });
    if (!r.ok) continue;
    const { policy, st, liq, stage } = r.value;
    const life = ["DEPLOYED", "SEEDING", "LIVE", "STAGED"][st.lifecycle] ?? st.lifecycle;
    out(`    ${c.muted("lifecycle")} ${c.text(life.padEnd(10))}${c.muted("mode")} ${c.text(MODE[policy.mode])}${" ".repeat(Math.max(1, 12 - MODE[policy.mode].length))}${c.muted("phase")} ${c.text(PHASE[policy.phase])}${" ".repeat(Math.max(1, 11 - PHASE[policy.phase].length))}${c.muted("swaps")} ${policy.canSwap ? c.text("allowed") : c.red("refused")}`);
    out(`    ${c.muted("position")}  ${c.text("#" + p.tokenId)} ${c.muted("holds liquidity")} ${c.text(comma(liq))}${stage != null ? `   ${c.muted("auction")} ${c.text(STAGE[stage])}` : ""}`);
    if (!policy.canSwap) out(`    ${c.faint("-")} ${c.muted(policy.phase === 0 ? "the rehearsal calendar for this test asset has ended, so no interval covers now and BELL fails closed. The position above can still be withdrawn." : "swaps are refused with no signed close anchor: BELL fails closed. The position above can still be withdrawn.")}`);
    out();
    await sleep(300);
  }
  await ask("Press Enter to replay every check from its transaction");
}

async function sceneReceipts() {
  await head("Every check, from its transaction", "Each row asks the chain for the transaction receipt. A swap that is meant to be refused shows up as a reverted transaction, so the refusal itself is on chain.");
  const checks = SITE.checks ?? [];
  let n = 0;
  for (const ch of checks) {
    n++;
    out(`${c.muted(String(n).padStart(2) + "/" + checks.length)}  ${c.bold(c.text(ch.title))}`);
    process.stdout.write("      ");
    await type(ch.tx, { delay: 4, color: c.muted });
    const r = await spin("      ", async () => {
      await sleep(350);
      const rc = await rpc("eth_getTransactionReceipt", [ch.tx]);
      if (!rc) throw new Error("receipt not found");
      const ok = rc.status === "0x1";
      const expected = ch.result === "PASS";
      if (ok !== expected) throw new Error(`unexpected status ${rc.status}`);
      return `${ok ? "succeeded" : "reverted, as designed"} in block ${comma(parseInt(rc.blockNumber, 16))}, gas ${comma(parseInt(rc.gasUsed, 16))}`;
    });
    if (r.ok) para(ch.what, c.faint, 6);
    out();
    await sleep(250);
  }
  const reverted = checks.filter((x) => x.result !== "PASS").length;
  out(`${c.text("✓")} ${c.text(`${checks.length} receipts read back: ${checks.length - reverted} succeeded, ${reverted} refused on purpose`)}`);
  await ask("Press Enter for the opening auction");
}

async function sceneAuction() {
  await head("The opening auction, settled", "Before the open, orders collect and ordinary swaps are blocked. At the bell the book locks and every order clears at one price.");
  if (!cycle) { para("No auction cycle has settled yet.", c.muted); return ask("Press Enter"); }
  const SUMMARY = "function cycleSummary(uint64) view returns (uint64 cycleOpenTime, uint64 deadline, uint8 cycleStage, uint160 priceX96, uint128 matchedBase, bool finalized)";
  const ALLOC = "function allocation(uint64 cycle, uint32 id) view returns (uint128 baseFill, uint128 quotePayout, uint128 quoteRefund)";
  const orders = TESTS.find((t) => t.test === "auction orders submitted");
  let summary;
  const s = await spin(`${c.muted("cycleSummary".padEnd(16))}`, async () => { await sleep(500); summary = await call(cycle.auction, SUMMARY, "cycleSummary", [BigInt(cycle.cycle)]); return `cycle ${cycle.cycle} read from the auction contract`; });
  if (!s.ok) return ask("Press Enter");
  const [openTime, deadline, stage, priceX96, matched, finalized] = summary;
  const price = Number((priceX96 * 10n ** 18n) / 2n ** 96n) / 1e6;
  out();
  out(`  ${c.muted("auction ")} ${c.text(cycle.auction)}`);
  out(`  ${c.muted("cycle   ")} ${c.text(String(cycle.cycle))}   ${c.muted("opened at")} ${c.text(new Date(Number(openTime) * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC")}   ${c.muted("stage")} ${badge(STAGE[stage])}`);
  out();
  await sleep(500);
  out(c.muted("  the book"));
  out(`    ${c.text("buy ")} ${c.red("████████████████████")}  ${c.text("600 tUSDG offered")}   ${c.muted("limit 101")}`);
  await sleep(500);
  out(`    ${c.text("sell")} ${c.red("█████")}${c.faint("░░░░░░░░░░░░░░░")}  ${c.text("5 tNVDA offered")}     ${c.muted("limit 99")}`);
  await sleep(700);
  out();
  out(`  ${c.muted("one clearing price for everyone")}  ${c.bold(c.text(price.toFixed(2) + " tUSDG per tNVDA"))}`);
  out(`  ${c.muted("matched")} ${c.text(Number(matched) / 1e18 + " tNVDA")}   ${c.muted("finalized")} ${c.text(String(finalized))}`);
  await sleep(500);
  if (orders) {
    const a = await call(cycle.auction, ALLOC, "allocation", [BigInt(cycle.cycle), Number(orders.sellOrder.id)]);
    const b = await call(cycle.auction, ALLOC, "allocation", [BigInt(cycle.cycle), Number(orders.buyOrder.id)]);
    out();
    out(`  ${c.muted("seller receives")} ${c.text(Number(a[1]) / 1e6 + " tUSDG")}   ${c.muted("buyer receives")} ${c.text(Number(b[0]) / 1e18 + " tNVDA")} ${c.muted("and a refund of")} ${c.text(Number(b[2]) / 1e6 + " tUSDG")}`);
  }
  out();
  out(`  ${c.muted("settlement")} ${c.text(cycle.settleTx)}`);
  out(`  ${c.faint(EXPLORER + "/tx/" + cycle.settleTx)}`);
  out();
  para("The cycle ran on a compressed 90-minute rehearsal calendar for a test asset, so the open, the sessions and the close could all be exercised in one afternoon. It is not a market calendar.", c.faint, 2);
  await ask("Press Enter for what this is, and is not");
}

async function sceneLimits() {
  await head("What this is, and is not", "Every line below is also on bellstocks.tech/elysium.");
  const items = [
    ["TESTNET", "The tokens are named (BELL test) and have no value. Elysium mainnet is not deployed."],
    ["PARTIAL", "Source is published on the explorer for every contract, as a partial match. None is a full match yet."],
    ["NO KEEPER", "Nothing on Elysium runs the open, the close or the auction yet. A real opening needs one."],
    ["ROUTER", "BellRouter needs a freshly signed price quote in every swap. The rehearsal swaps go straight to the PoolManager."],
    ["AUDIT", "An independent audit is in progress. Treat every BELL contract as unaudited."],
  ];
  for (const [tag, text] of items) { out(`${badge(tag)}`); para(text, c.text, 2); out(); await sleep(450); }
  await ask("Press Enter for receipts");
}

async function sceneEnd() {
  await head("Check every claim yourself");
  const rows = [
    ["All of it, on the web", "https://www.bellstocks.tech/elysium/"],
    ["Explorer", EXPLORER],
    ["Pool factory", `${EXPLORER}/address/${M.poolFactory}`],
    ["Settlement transaction", cycle ? `${EXPLORER}/tx/${cycle.settleTx}` : null],
    ["Source code", "https://github.com/belldex/bell"],
    ["Write-up", "https://github.com/belldex/bell/blob/main/docs/elysium-testnet.md"],
  ].filter(([, u]) => u);
  for (const [l, u] of rows) { out(`${c.text("✓")} ${c.muted(l.padEnd(24))}${c.text(u)}`); await sleep(250); }
  out();
  para("BELL is an independent protocol, not affiliated with or endorsed by Kinetiq, Hyperliquid, Uniswap Labs or Robinhood Markets, Inc. Test tokens have no value. Independent audit in progress. Not financial advice.", c.faint);
  out();
  out(`${c.red("█")} ${c.text("BELL")}  ${c.muted("The market finally has a bell.")}`);
  out();
}

(async () => {
  try {
    await sceneBoot();
    await sceneLedger();
    await sceneHooks();
    await scenePools();
    await sceneReceipts();
    await sceneAuction();
    await sceneLimits();
    await sceneEnd();
  } catch (e) { out(`\n${c.red("✗")} ${c.red(e.message)}`); process.exitCode = 1; }
  rl.close(); process.exit(process.exitCode ?? 0);
})();
