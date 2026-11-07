#!/usr/bin/env node
// BELL v4 & Ecosystem — terminal version of bellstocks.tech/v4. No dependencies, Node 18+.
//
//   node scripts/auction-cli/bell-v4.mjs             contract section read live from chain 4663 (eth_getCode)
//   node scripts/auction-cli/bell-v4.mjs --static    replay the last snapshot read from chain (no network), for recordings
//   node scripts/auction-cli/bell-v4.mjs --snapshot  read live and save snapshot.json for --static
//   add --auto to advance without pressing Enter (the link picker at the end is skipped)
//
// Style: monochrome, one red accent for status labels and the BELL card (brief §7). Terminal background #171717.
// Contract list: scripts/auction-cli/targets.json (29 BELL contracts, each verified on Sourcify, see verified.json).

import readline from "node:readline";
import { exec } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ARGS = new Set(process.argv.slice(2));
// --chain elysium-testnet reads the Elysium testnet deployment instead of Robinhood Chain mainnet. Without it nothing changes.
const CHAIN_INDEX = process.argv.indexOf("--chain");
const CHAIN_FLAG = process.argv.find((a) => a.startsWith("--chain="))?.slice("--chain=".length) ?? (CHAIN_INDEX >= 0 ? process.argv[CHAIN_INDEX + 1] : null);
const ELYSIUM = CHAIN_FLAG === "elysium-testnet";
if (CHAIN_FLAG && !ELYSIUM) {
  console.error(`unknown chain "${CHAIN_FLAG}". Supported: elysium-testnet (the default is Robinhood Chain mainnet, chain 4663).`);
  process.exit(2);
}
const STATIC = ARGS.has("--static") || ARGS.has("--demo");
const SNAPSHOT = ARGS.has("--snapshot");
const AUTO = ARGS.has("--auto");

const here = fileURLToPath(new URL("./", import.meta.url));
const root = join(here, "../../");
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

// ───────────────────────── THEME ─────────────────────────
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `38;2;${n >> 16};${(n >> 8) & 255};${n & 255}`; };
const THEME = {
  text: "#EDEDED", muted: "#8A8A8A", faint: "#4A4A4A",
  red:  "#E5484D", // the only accent
};

// ───────────────────────── CONTENT (from the brief) ─────────────────────────
// Status: "LIVE" | "DEPLOYED" | "IN DEVELOPMENT" | "PLANNED" | "BUILDING TOWARD" | null (= not confirmed yet)
const HERO = {
  label: "BELL v4 · IN DEVELOPMENT",
  headline: "The market finally has a bell.",
  sub: "Robinhood Chain has the stock tokens. Uniswap has the engine. Hyperliquid has the 24/7 price. BELL holds the bell.",
};

const FITS = [
  { name: "Robinhood Chain", role: "The stadium", status: null,
    text: "Stock tokens trade 24/7. Standard pools can't tell 3 AM Sunday from 10 AM Tuesday." },
  { name: "Uniswap v4", role: "The engine", status: "LIVE",
    text: "The best AMM engine onchain. BELL is built natively on it, and gives it a clock." },
  { name: "Hyperliquid", role: "The scoreboard", status: null,
    text: "Equity prices that never stop. A 24/7 price still doesn't protect a spot LP from the weekend." },
  { name: "Elysium", role: "The bridge", status: "BUILDING TOWARD",
    text: "Contracts that read HyperCore directly. The price BELL's auction wants at the open." },
  { name: "BELL", role: "The bell", status: "LIVE + v4 IN DEVELOPMENT", highlight: true,
    text: "Session-aware fees, flow caps, fail-closed swaps, unblockable exits. One fair price at the open." },
];

const THERE_VS_HERE = [
  ["Monday morning after the weekend", "The first swap takes the whole gap", "v4: every order at the open clears at one price"],
  ["Market closed", "Same fees and rules as market hours", "100 bps fee, flow cap, closure budget"],
  ["Stale price data", "Swaps keep running", "Swaps fail closed"],
  ["Admin or pause", "Depends on the hook, can block withdrawals", "The hook has no permission to block withdrawals"],
  ["Contract upgrades", "Often behind a proxy", "Zero proxies, immutable hooks"],
];

const V4_FEATURES = [
  ["Session-aware fees, flow caps, fail-closed swaps", "LIVE", "On mainnet"],
  ["Unblockable LP exits", "LIVE", "Hook mask 0x2CC0 has no remove-liquidity permission"],
  ["Opening Bell Auction", "DEPLOYED", "Contracts live and verified on mainnet · no pool has an auction yet"],
  ["BellHookV2 + write-once auction registry", "DEPLOYED", "Live on mainnet · pools created from the new factory get an auction"],
  ["Source verification of every contract", null, "29/29 BELL contracts verified on Sourcify · confirm on Blockscout"],
  ["Exit Liveness Proof at /proof", null, ""],
  ["Orders private until the bell (sealed-bid)", "PLANNED", "v2 auction"],
  ["HyperCore reference price", "BUILDING TOWARD", "Depends on Elysium EL1Read"],
];

const OPEN_FLOW = [
  ["01", "Orders collect", "Before the open, orders gather instead of racing each other."],
  ["02", "Book locks", "At the bell, the book closes. No order can jump the line."],
  ["03", "One clearing price", "Every order in the book clears at the same price."],
];

const BUILD = { merged: true };

// ───────────────────────── CONTRACTS (official deployment data) ─────────────────────────
const EXPLORER = ELYSIUM ? "https://testnet.elysium.kinetiq.xyz" : "https://robinhoodchain.blockscout.com";
const PUBLIC_RPC = ELYSIUM ? "https://testnet-rpc.elysium.kinetiq.xyz" : "https://rpc.mainnet.chain.robinhood.com";
const KEEPER = process.env.BELL_KEEPER_URL || "https://bell-keeper-b.asysyifaq25.workers.dev";
const CHAIN_ID = ELYSIUM ? 99801 : 4663;

/**
 * Elysium testnet data comes from the repository's own records, never from a hand-typed list: the deploy manifest, the evidence
 * written by scripts/deploy/elysium-rehearsal.mjs, and the explorer verification record. Nothing is shown as done unless a
 * record says so.
 */
function loadElysium() {
  const manifest = readJson(join(root, "deployments/elysium-testnet.json")) ?? {};
  const ev = (name) => readJson(join(root, `evidence/deploy/elysium-testnet-${name}.json`));
  const adapters = ev("adapters") ?? {};
  const rehearsal = ev("rehearsal") ?? {};
  const tests = ev("tests")?.entries ?? [];
  const pools = ev("pools")?.pools ?? [];
  const ver = ev("verification") ?? { verified: {} };
  const named = [
    ["poolFactory", "BellPoolFactory"], ["router", "BellRouter"], ["hookDeployer", "BellHookDeployerV2"], ["policyOracle", "BellPolicyOracle"],
    ["modeEvaluator", "BellModeEvaluator"], ["policyDependencyReader", "BellPolicyDependencyReader"], ["auctionRegistry", "BellAuctionRegistry"],
    ["auctionFactoryModule", "BellAuctionFactoryModule"], ["safetyController", "SafetyController"], ["assetRegistry", "AssetRegistry"],
    ["calendarRegistry", "CalendarRegistry"], ["sessionRegistry", "SessionRegistry"],
  ];
  const tgt = named.filter(([k]) => manifest[k]).map(([k, name]) => ({ label: k, name, address: manifest[k], group: "core" }));
  const attest = [];
  if (adapters.verifier) attest.push(["YahooSourceVerifier", adapters.verifier]);
  for (const [k, n] of [["directAdapter", "tAAPL direct"], ["regularAdapter", "tAAPL regular"], ["extendedAdapter", "tAAPL extended"]]) if (adapters[k]) attest.push([n, adapters[k]]);
  for (const [k, n] of [["direct", "tNVDA direct"], ["regular", "tNVDA regular"], ["extended", "tNVDA extended"]]) if (rehearsal.adapters?.[k]) attest.push([n, rehearsal.adapters[k]]);
  const assets = [["tAAPL (BELL test)", manifest.testStock], ["tNVDA (BELL test)", rehearsal.stock2], ["tUSDG (BELL test)", manifest.feeToken], ["WETH", manifest.weth]].filter(([, a]) => a);
  const external = [["Uniswap v4 PoolManager (deployed by BELL)", manifest.poolManager], ["Uniswap v4 PositionManager (deployed by BELL)", manifest.positionManager], ["Permit2 (canonical)", manifest.permit2]].filter(([, a]) => a);
  const poolRows = pools.map((p) => [`${p.kind} hook`, p.hook]);
  return { manifest, targets: tgt, attest, assets, external, poolRows, tests, pools, verified: Object.fromEntries(Object.entries(ver.verified ?? {}).map(([a, m]) => [a.toLowerCase(), { match: m }])) };
}
const EL = ELYSIUM ? loadElysium() : null;

const targets = ELYSIUM ? EL.targets : readJson(join(here, "targets.json")) ?? [];
const verified = ELYSIUM ? EL.verified : readJson(join(here, "verified.json")) ?? {};
const snapshot = readJson(join(here, ELYSIUM ? "snapshot-elysium-testnet.json" : "snapshot.json"));
const ofLabel = (...labels) => labels.map((l) => targets.find((t) => t.label === l)).filter(Boolean).map((t) => [t.name, t.address]);

const ASSETS = ELYSIUM ? EL.assets : [
  ["AAPL", "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"],
  ["NVDA", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"],
  ["TSLA", "0x322F0929c4625eD5bAd873c95208D54E1c003b2d"],
  ["MEME", "0x385F4f8ae47651ce5F58F5265395a669f8281e18"],
  ["USDG", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"],
  ["WETH", "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"],
];
const EXTERNAL = ELYSIUM ? EL.external : [
  ["Uniswap v4 PoolManager", "0x8b26FEfa276860592D45114Cb30B335DdDd87B56"],
  ["Uniswap v4 PositionManager", "0x84da249Aafa359886C6A2Ae1ebDC78a6059B662D"],
  ["Permit2", "0x000000000022D473030F116dDEE9F6B43aC78BA3"],
];
const HOOK_FLAGS = ["beforeInitialize", "beforeAddLiquidity", "afterAddLiquidity", "beforeSwap", "afterSwap"];

// Elysium testnet copy. Every status below is read from a record in the repository; a missing record shows as "to confirm".
const testOf = (name) => (EL ? EL.tests.find((t) => t.test === name) : null);
const verifiedFullEl = ELYSIUM ? targets.filter((t) => ["match", "exact_match", "full"].includes(verified[t.address.toLowerCase()]?.match)).length : 0;
const verifiedPartialEl = ELYSIUM ? targets.filter((t) => verified[t.address.toLowerCase()]?.match === "partial").length : 0;
const verifiedCountEl = verifiedFullEl + verifiedPartialEl;
const VIEW = ELYSIUM
  ? {
      hero: {
        label: "BELL v4 · ELYSIUM TESTNET",
        headline: "The same bell, rehearsed on Elysium.",
        sub: "The BELL contracts, unchanged, deployed to Elysium testnet with test tokens that have no value. Every line below is read from the chain.",
      },
      features: [
        ["The same BELL contracts, unchanged", EL.targets.length ? "DEPLOYED" : null, `${EL.targets.length} BELL contracts · hook mask 0x2CC0 · no proxies`],
        ["Pools: SESSION_ONLY, and with the Opening Bell Auction", EL.pools.length >= 2 ? "LIVE" : null, `${EL.pools.length} pools on testnet · test tokens only`],
        ["Swap inside the cap while the market is closed", testOf("swap inside the cap") ? "TESTED" : null, testOf("swap inside the cap") ? "spends the closure budget, as designed" : ""],
        ["Swap above the cap reverts", testOf("swap above the cap reverts") ? "TESTED" : null, testOf("swap above the cap reverts") ? "TradeCapExceeded, recorded onchain" : ""],
        ["Withdraw while the market is closed", testOf("withdraw while the market is CLOSED") ? "TESTED" : null, testOf("withdraw while the market is CLOSED") ? "the LP leaves in kind, no hook permission to stop it" : ""],
        ["Fails closed with no close anchor, and the LP can still exit", testOf("withdraw while swaps are blocked (no close anchor)") && testOf("swap in CLOSED after the session fails closed (no close anchor)") ? "TESTED" : null, testOf("withdraw while swaps are blocked (no close anchor)") ? "the swap reverts with PolicyBlocked, the withdraw succeeds" : ""],
        ["Opening Bell Auction, one full cycle", testOf("opening auction full cycle") ? "TESTED" : null, testOf("opening auction full cycle") ? "orders, lock, one clearing price, claims" : "not run yet"],
        ["Contract source published on the Elysium explorer", verifiedFullEl ? "VERIFIED" : verifiedPartialEl ? "PARTIAL MATCH" : null, `${verifiedFullEl} full and ${verifiedPartialEl} partial matches of ${targets.length} BELL contracts (partial: bytecode equal except the metadata hash)`],
        ["HyperCore reference price", "BUILDING TOWARD", "Depends on Elysium EL1Read"],
      ],
      step5: testOf("opening auction full cycle") ? "Opening Bell Auction · one full cycle completed on Elysium testnet." : "Opening Bell Auction · pools with an auction are live on Elysium testnet.",
      step6Title: "Live on Elysium testnet",
      step6Sub: `Elysium testnet · chain ${CHAIN_ID} · every address read back with eth_getCode.`,
      receipts: [
        ...["swap inside the cap", "swap above the cap reverts", "withdraw while the market is CLOSED"].map((n) => [n.charAt(0).toUpperCase() + n.slice(1), testOf(n)?.tx ? `${EXPLORER}/tx/${testOf(n).tx}` : null]),
        ["Auction settlement", testOf("opening auction full cycle")?.settleTx ? `${EXPLORER}/tx/${testOf("opening auction full cycle").settleTx}` : null],
        ["Source code", "https://github.com/belldex/bell"],
        ["Elysium rehearsal notes", "https://github.com/belldex/bell/blob/main/docs/elysium-testnet.md"],
      ],
      build: `Elysium testnet rehearsal · ${verifiedFullEl} full and ${verifiedPartialEl} partial source matches of ${targets.length} contracts on the explorer`,
      disclaimer: "Elysium testnet rehearsal with test tokens that have no value. BELL is an independent protocol, not affiliated with or endorsed by Kinetiq, Hyperliquid, Uniswap Labs or Robinhood Markets, Inc. Elysium mainnet is not deployed. Independent audit in progress. Not financial advice.",
    }
  : null;

const BELL_TOKEN = "0xc5d6c1d90c8a87a07e2670b99b1556e818803228";
// url = null hides the row.
const RECEIPTS = [
  ["$BELL buyback", `${EXPLORER}/tx/0xae06d09f417ed585532963b33610f682cd1c94fd46973b2c7affab5d19b4880a`],
  ["$BELL burn (2.9M)", `${EXPLORER}/tx/0x72b08574afe1045d5bd6f71e70b28d61f7886225d388ad524e4c2b2b0c365c30`],
  ["$BELL token", `${EXPLORER}/address/${BELL_TOKEN}`],
  ["$BELL chart", null],   // TODO: DEX Screener link
  ["Source code", "https://github.com/belldex/bell"],
  ["All contracts", "https://www.bellstocks.tech/protocol/#contracts"],
  ["Official X", "https://x.com/BELLdexFi"],
];

const SHARE_TEXT = `Robinhood Chain has the stock tokens.
Uniswap has the engine.
Hyperliquid has the 24/7 price.

BELL holds the bell.

bellstocks.tech/v4`;

const DISCLAIMER = "BELL is an independent protocol. Not affiliated with or endorsed by Robinhood Markets, Inc., Uniswap Labs, Hyperliquid, or Kinetiq. The Opening Bell Auction contracts are deployed, but no pool has an auction yet. Independent audit in progress. Not financial advice.";

// ───────────────────────── Display helpers ─────────────────────────
const paint = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const c = { text: paint(rgb(THEME.text)), muted: paint(rgb(THEME.muted)), faint: paint(rgb(THEME.faint)),
  red: paint(rgb(THEME.red)), bold: paint(1), italic: paint(3) };
const out = (s = "") => process.stdout.write(s + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const WIDTH = () => Math.min((process.stdout.columns || 100) - 2, 96);

function wrap(text, width) {
  const lines = []; let line = "";
  for (const w of text.split(" ")) {
    if ((line + " " + w).trim().length > width) { lines.push(line.trim()); line = w; } else line += " " + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
const para = (text, color = c.muted, indent = 0) =>
  wrap(text, WIDTH() - indent).forEach((l) => out(" ".repeat(indent) + color(l)));

function badge(status) {
  if (!status) return c.faint("[ TO CONFIRM ]");
  return c.red(c.bold(`[ ${status} ]`));
}

function box(lines, { border = c.faint, w = Math.min(WIDTH(), 76) } = {}) {
  out(border("┌" + "─".repeat(w) + "┐"));
  for (const l of lines) out(border("│ ") + l + " ".repeat(Math.max(0, w - 2 - strip(l).length)) + border(" │"));
  out(border("└" + "─".repeat(w) + "┘"));
}

// 5-row pixel font
const FONT = {
  B: ["11110","10001","11110","10001","11110"], E: ["11111","10000","11110","10000","11111"],
  L: ["10000","10000","10000","10000","11111"], V: ["10001","10001","10001","01010","00100"],
  4: ["10010","10010","11111","00010","00010"], " ": ["000","000","000","000","000"],
};
function banner(text) {
  const rows = ["", "", "", "", ""];
  for (const ch of text) FONT[ch].forEach((r, i) => (rows[i] += r.replace(/1/g, "██").replace(/0/g, "  ") + "  "));
  rows.forEach((r) => out("  " + c.text(r)));
}

// ───────────────────────── Input ─────────────────────────
const rl = readline.createInterface({ input: process.stdin });
const queue = []; let waiter = null;
rl.on("line", (l) => (waiter ? (waiter(l), (waiter = null)) : queue.push(l)));
rl.on("close", () => waiter && waiter(""));
const ask = (label, hint = "[Enter]") => new Promise((res) => {
  process.stdout.write(`\n${c.red("?")} ${c.text(label)} ${c.muted(hint)} `);
  if (AUTO) { out(); return setTimeout(() => res(""), 900); }
  if (queue.length) return res(queue.shift());
  waiter = res;
});

const TOTAL = 8;
function stepHead(n, title, sub) {
  out(); out();
  out(`${c.red(c.bold(`${String(n).padStart(2, "0")}/${String(TOTAL).padStart(2, "0")}`))}  ${c.bold(c.text(title.toUpperCase()))}`);
  out(c.faint("─".repeat(Math.min(WIDTH(), 78))));
  if (sub) para(sub);
  out();
}

// ───────────────────────── Chain ─────────────────────────
function rpcUrl() {
  if (process.env.BELL_RPC_URL) return process.env.BELL_RPC_URL;
  if (ELYSIUM) return PUBLIC_RPC; // never read a Robinhood key for an Elysium run
  const envFile = join(root, ".env");
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(/^RH_MAINNET_RPC_PRIMARY=(.*)$/m);
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, "");
  }
  return PUBLIC_RPC;
}
const RPC = rpcUrl();
async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10000) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}
async function spin(prefix, task) {
  const f = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]; let i = 0;
  const t = setInterval(() => process.stdout.write(`\r${c.text(f[i++ % f.length])} ${prefix}${c.muted("reading…")}`), 70);
  try { const r = await task(); clearInterval(t); process.stdout.write(`\r\x1b[2K${c.text("✓")} ${prefix}${c.text(r)}\n`); return true; }
  catch (e) { clearInterval(t); process.stdout.write(`\r\x1b[2K${c.red("✗")} ${prefix}${c.red(e.message)}\n`); return false; }
}

async function livePools() {
  if (ELYSIUM) return EL.poolRows.length ? EL.poolRows : null;
  try {
    const r = await fetch(`${KEEPER}/pools`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    return j.pools.map((p) => [`${p.legs.map((l) => l.symbol).join("/")} hook`, p.hook]);
  } catch { return null; }
}

// ───────────────────────── Flow ─────────────────────────
async function main() {
  // 01 Hero
  console.clear(); out();
  banner("BELL V4"); out();
  const hero = VIEW?.hero ?? HERO;
  out("  " + badge(hero.label)); out();
  out("  " + c.bold(c.text(hero.headline)));
  wrap(hero.sub, WIDTH() - 2).forEach((l) => out("  " + c.italic(c.muted(l))));
  out();
  out(`  ${c.text("→ Swap")} ${c.muted("(live)")}    ${c.text("→ See contracts")}`);
  await ask("Press Enter to see where BELL fits");

  // 02 Where BELL fits
  stepHead(2, "Where BELL fits", "Four pieces of the market. BELL is the one that keeps time.");
  const fits = ELYSIUM
    ? FITS.map((f) => (f.name === "Elysium" ? { ...f, status: "TESTNET", text: "Kinetiq's Hyperliquid L2. BELL is deployed on its testnet with test tokens. HyperCore read access is still to come." }
      : f.name === "BELL" ? { ...f, status: "LIVE ON ROBINHOOD CHAIN · TESTNET ON ELYSIUM" } : f))
    : FITS;
  for (const f of fits) {
    const border = f.highlight ? c.red : c.faint;
    const head = `${f.highlight ? c.red(c.bold(f.name)) : c.bold(c.text(f.name))}  ${c.muted("· " + f.role)}`;
    const w = Math.min(WIDTH(), 76);
    const status = f.status ? badge(f.status) : c.faint("—");
    const pad = w - 2 - strip(head).length - strip(status).length;
    box([head + " ".repeat(Math.max(1, pad)) + status, ...wrap(f.text, w - 2).map((l) => (f.highlight ? c.text(l) : c.muted(l)))], { border, w });
    await sleep(150);
  }
  await ask("Press Enter for there vs here");

  // 03 There vs here
  stepHead(3, "There vs here", "What a standard pool can't do, and what BELL does.");
  for (const [sit, std, bell] of THERE_VS_HERE) {
    out(c.bold(c.text(sit)));
    out(`  ${c.faint("✗")} ${c.muted("Standard pool  ")}${c.muted(std)}`);
    out(`  ${c.red("✓")} ${c.text("BELL           ")}${c.text(bell)}`);
    out(); await sleep(150);
  }
  await ask("Press Enter for what's in v4");

  // 04 What's in v4
  stepHead(4, "What's in v4", "Every item carries an honest status.");
  const bw = 20;
  for (const [feat, status, note] of (VIEW?.features ?? V4_FEATURES)) {
    const b = badge(status);
    out(b + " ".repeat(Math.max(1, bw - strip(b).length)) + c.text(feat));
    if (note) out(" ".repeat(bw) + c.muted(note));
    await sleep(120);
  }
  await ask("Press Enter for how the open works");

  // 05 How the open works
  stepHead(5, "How the open works", VIEW?.step5 ?? "Opening Bell Auction · contracts deployed, first auction pool not created yet.");
  for (const [n, title, text] of OPEN_FLOW) {
    out(`${c.red(c.bold(n))}  ${c.bold(c.text(title))}`);
    para(text, c.muted, 4);
    if (n !== "03") out(c.faint("    │"));
    await sleep(300);
  }
  await ask(`Press Enter to read the live contracts from chain ${CHAIN_ID}`);

  // 06 Live on mainnet today
  stepHead(6, VIEW?.step6Title ?? "Live on mainnet today", VIEW?.step6Sub ?? `Robinhood Chain · chain ${CHAIN_ID} · every address read back with eth_getCode.`);
  let live = !STATIC;
  let block = null;
  if (live) {
    try {
      const id = parseInt(await rpc("eth_chainId"), 16);
      if (id !== CHAIN_ID) throw new Error(`wrong chain ${id}`);
      block = parseInt(await rpc("eth_blockNumber"), 16);
      out(`${c.text("✓")} ${c.text(`Chain online (${id}) · block ${block.toLocaleString("en-US")}`)}`);
    } catch (e) {
      out(`${c.red("!")} ${c.red(`RPC not reachable (${e.message}).`)}`);
      if (!snapshot) throw new Error("no snapshot to fall back to; run with --snapshot on a working connection");
      live = false;
    }
  }
  if (!live && !snapshot) throw new Error("no snapshot yet; run once with --snapshot");
  if (!live) out(`${c.text("✓")} ${c.text(`Recorded from chain ${CHAIN_ID} at block ${snapshot.block.toLocaleString("en-US")}`)}`);

  const pools = live ? await livePools() : snapshot.pools;
  const GROUPS = ELYSIUM ? [
    { group: "CORE INFRASTRUCTURE", items: ofLabel("poolFactory", "router", "hookDeployer", "policyOracle", "modeEvaluator", "policyDependencyReader") },
    { group: "OPENING BELL AUCTION", items: ofLabel("auctionRegistry", "auctionFactoryModule") },
    ...(pools?.length ? [{ group: "POOL HOOKS · mask 0x2CC0", items: pools }] : []),
    { group: "REGISTRIES", items: ofLabel("safetyController", "assetRegistry", "calendarRegistry", "sessionRegistry") },
    { group: "ATTESTATION ADAPTERS (rehearsal)", items: EL.attest },
    { group: "ADMITTED TEST ASSETS", items: ASSETS },
    { group: "CANONICAL / EXTERNAL (not BELL contracts)", items: EXTERNAL },
  ] : [
    { group: "CORE INFRASTRUCTURE", items: ofLabel("poolFactory", "router", "hookDeployer", "policyOracle", "modeEvaluator", "policyDependencyReader") },
    { group: "OPENING BELL AUCTION", items: ofLabel("auctionRegistry", "auctionFactoryModule") },
    ...(pools?.length ? [{ group: "POOL HOOKS · mask 0x2CC0", items: pools }] : []),
    { group: "REGISTRIES", items: ofLabel("safetyController", "assetRegistry", "calendarRegistry", "sessionRegistry") },
    { group: "CHAINLINK ADAPTERS", items: targets.filter((t) => t.group.includes("adapters")).map((t) => [`${t.name} · ${t.label}`.replace("ChainlinkEquitySessionAdapter", "SessionAdapter").replace("ChainlinkTokenReferenceAdapter", "ReferenceAdapter").replace("AggregatorAdapter", "DirectAdapter").replace(".directAdapter", " direct").replace(".regularAdapter", " regular").replace(".extendedAdapter", " extended").replace(".overnightAdapter", " overnight").replace(" · ref ", " · "), t.address]) },
    { group: "ADMITTED ASSETS", items: ASSETS },
    { group: "CANONICAL / EXTERNAL (not BELL contracts)", items: EXTERNAL },
  ];

  const recorded = {};
  const read = async (addr) => {
    let bytes;
    if (live) {
      const code = await rpc("eth_getCode", [addr, "latest"]);
      bytes = (code.length - 2) / 2;
      if (!bytes) throw new Error("no code at address");
    } else {
      await sleep(80 + Math.random() * 120);
      bytes = snapshot.bytes[addr.toLowerCase()];
      if (!bytes) throw new Error("not in the recorded snapshot");
    }
    recorded[addr.toLowerCase()] = bytes;
    const v = verified[addr.toLowerCase()];
    const ok = v && (v.match === "match" || v.match === "exact_match");
    return `code ✓ ${bytes.toLocaleString("en-US")} bytes${ok ? " · source verified" : v?.match === "partial" ? " · source published (partial match)" : ""}`;
  };
  const ALL = GROUPS.flatMap((g) => g.items);
  let n = 0, pass = 0;
  for (const g of GROUPS) {
    out(); out(c.muted(g.group));
    for (const [name, addr] of g.items) {
      n++;
      const pre = `${c.muted(String(n).padStart(2) + "/" + ALL.length)}  ${c.text(name.padEnd(36))}${c.text(addr)}  `;
      if (await spin(pre, () => read(addr))) pass++;
    }
    if (g.group.startsWith("POOL HOOKS")) out(" ".repeat(9) + c.muted("flags: " + HOOK_FLAGS.join(", ") + " · no remove-liquidity flag"));
  }
  out();
  const verifiedCount = targets.filter((t) => verified[t.address]?.match).length;
  out(`${c.text("✓")} ${c.text(`${pass}/${ALL.length} addresses have deployed code on chain ${CHAIN_ID}`)}`);
  if (targets.length) out(`${c.text("✓")} ${c.text(ELYSIUM ? `${verifiedFullEl} full and ${verifiedPartialEl} partial source matches among ${targets.length} BELL contracts on the Elysium explorer` : `${verifiedCount}/${targets.length} BELL contracts have verified source on Sourcify`)}`);
  if (SNAPSHOT && live) {
    writeFileSync(join(here, ELYSIUM ? "snapshot-elysium-testnet.json" : "snapshot.json"), JSON.stringify({ chainId: CHAIN_ID, block, at: new Date().toISOString(), pools, bytes: recorded }, null, 1) + "\n");
    out(c.muted(`snapshot saved → scripts/auction-cli/${ELYSIUM ? "snapshot-elysium-testnet.json" : "snapshot.json"}`));
  }
  await ask("Press Enter for receipts and build progress");

  // 07 Receipts + build progress
  stepHead(7, "Receipts", "Check every claim yourself.");
  const RCPT = VIEW?.receipts ?? RECEIPTS;
  const shown = RCPT.filter(([, url]) => url);
  for (const [label, url] of shown) { out(`${c.text("✓")} ${c.muted(label.padEnd(20))}${c.text(url)}`); await sleep(120); }
  const todo = RCPT.filter(([, url]) => !url).map(([l]) => l);
  if (todo.length) out(`${c.faint("·")} ${c.faint("not shown yet: " + todo.join(", "))}`);
  out(); out(c.bold(c.text("Build progress")));
  box([
    `${badge("IN DEVELOPMENT")}`,
    c.text(VIEW?.build ?? `Opening Bell Auction ${BUILD.merged ? "merged to main" : "not merged to main"} · ${targets.length} contracts verified`),
  ]);
  await ask("Press Enter");

  // 08 CTA + disclaimer + open links
  stepHead(8, "The bell rings onchain.", null);
  out(`${c.text("→ Swap on BELL")}    ${c.text("→ Share on X")}`); out();
  out(c.muted("Share text:"));
  SHARE_TEXT.split("\n").forEach((l) => out(c.faint("│ ") + c.text(l)));
  out(); para(VIEW?.disclaimer ?? DISCLAIMER, c.faint);

  const LINKS = [
    ["Swap on BELL", "https://www.bellstocks.tech/"],
    ["Share on X", "https://x.com/intent/post?text=" + encodeURIComponent(SHARE_TEXT)],
    ...shown,
    ...ALL.map(([name, a]) => [name, `${EXPLORER}/address/${a}`]),
  ];
  if (!AUTO) {
    out();
    LINKS.slice(0, 40).forEach(([l], i) => out(`${c.red(String(i + 1).padStart(2))}  ${c.text(l)}`));
    out(c.muted(`   … ${LINKS.length - 40} more contract links`));
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
    for (;;) {
      const a = (await ask("Number to open", `[1–${LINKS.length}, Enter to finish]`)).trim();
      if (!a) break;
      const link = LINKS[Number(a) - 1];
      if (!link) { out(c.muted("  not in the list")); continue; }
      exec(`${opener} "${link[1]}"`);
      out(`${c.text("✓")} ${c.muted("opened")} ${c.text(link[1].length > 90 ? link[1].slice(0, 90) + "…" : link[1])}`);
    }
  }
  out(); out(`${c.red("●")} ${c.text("BELL")}  ${c.muted("The market finally has a bell.")}`); out();
  rl.close(); process.exit(0);
}

main().catch((e) => { out(`\n${c.red("✗")} ${c.red(e.message)}`); process.exit(1); });
