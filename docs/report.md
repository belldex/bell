# BELL — Project Report & Architecture Overview

**Session-Aware Automated Market Maker for Robinhood Chain Stock Tokens (EVM Mainnet 4663)**

- **Web Application:** https://bell-black.vercel.app
- **Pool Directory:** https://bell-black.vercel.app/pools
- **Create & Seed Terminal:** https://bell-black.vercel.app/create
- **Swap Terminal:** https://bell-black.vercel.app/swap
- **Position Manager:** https://bell-black.vercel.app/positions
- **Protocol & Verified Contracts Registry:** https://bell-black.vercel.app/protocol#contracts
- **Terms & Legal Disclosures:** https://bell-black.vercel.app/terms · https://bell-black.vercel.app/privacy
- **GitHub Repository:** https://github.com/belldex/bell (branch `main`)
- **Official X:** https://x.com/BELLdexFi

---

## 1. Project Description

**BELL** (*Bourse-Event Liquidity Layer*) is an independent, noncustodial automated market maker built natively on **Uniswap v4** for **Robinhood Chain Mainnet (EVM chain 4663)**. It is specifically engineered to bridge traditional stock market trading hours with 24/7 decentralized finance.

Traditional stock markets operate across distinct phases—pre-market, regular exchange hours, after-hours, overnight, and weekend/holiday closures. Crypto automated market makers, by contrast, run continuously with static fees and unbounded flow, leaving liquidity providers vulnerable to toxic arbitrage, stale oracle latency, and off-market price divergence.

BELL resolves this by embedding dynamic, session-aware policies directly into immutable Uniswap v4 pool hooks:
1. **Dynamic Session-Priced LP Fees:** Base LP fees adapt per session (`0.05%` in REGULAR, `0.30%` in PRE/POST, `0.50%` in OVERNIGHT, and `1.00%` in CLOSED), returned directly onchain via `beforeSwap`.
2. **Two-Sided Flow Limits:** Each pool enforces per-trade limits and rolling gross-flow windows that cannot be bypassed or artificially refilled by deposits.
3. **Dual Pool Archetypes:**
   - **`PRICE_GUARDED`:** For assets with approved external price feeds (Chainlink AggregatorV3). Verifies feed freshness (60s REGULAR / 120s extended) and enforces tight price bands; steps aside into a strict AMM fallback if external data goes stale.
   - **`SESSION_ONLY`:** For tokenized assets without independent price feeds (e.g., MEME/NVDA). Prices purely from AMM liquidity while enforcing session fees and flow limits.
4. **Noncustodial Position NFTs:** Pools are seeded atomically via `createAndSeed`, minting standard Uniswap v4 PositionManager ERC-721 tokens owned directly by user wallets. In-kind LP withdrawals can never be blocked by hook policy.

All smart contracts are deployed live on Robinhood Chain Mainnet (4663) with zero upgradeable proxy risk.

---

## 2. Core Value Proposition & Problem Solved

### The Problem

- **Static Fee Models on Dynamic Assets:** Standard AMMs apply uniform fees regardless of whether underlying stock venues are liquid or closed.
- **Oracle Staleness & Arbitrage:** When equity markets close or experience off-hours halts, stale or sparse price updates create toxic arbitrage windows against passive liquidity providers.
- **Unbounded Flow Risk:** In low-liquidity or off-market hours, predatory volume can drain pool reserves before LPs have time to react.
- **Lack of Legitimate Stock Token AMMs:** Robinhood Stock Tokens exist on Robinhood Chain, but lack customized, institutional-grade AMM infrastructure respecting real-world market calendars.

### The BELL Solution

- **Onchain Exchange Calendar Commitment:** Merkle-committed calendar intervals advance based on published exchange schedules. Swaps fail closed if a session is uncertain (`UNKNOWN`).
- **Atomic Create & Seed:** A single transaction mines deterministic hook salt, deploys an isolated immutable hook, mints position liquidity, and refunds unspent dust.
- **Fail-Closed Oracle Gate:** `BellPolicyOracle` enforces strict Chainlink heartbeat gates. When market data is stale or unavailable, checked pools step aside to strict protective flow caps rather than guessing.
- **Guaranteed Liquidity Exit:** The hook deliberately excludes `beforeRemoveLiquidity` permissions. Even during emergencies or market halts, LPs can withdraw principal in-kind.
- **Zero Upgradeable Proxies:** Every deployed hook instance is immutable, mathematically locking its configuration, tokens, and caps at creation.

---

## 3. End-to-End Application Flow

```
[Trader / Liquidity Provider Wallet]
        │
        ▼
1. Web Application Terminal (https://bell-black.vercel.app)
    ├── Pools      → Inspect live onchain factory directory & real depth
    ├── Create     → 4-step wizard: select pair, pool class, seed ratio, & deploy
    ├── Swap       → Simulate exact-in / exact-out quotes & execute via BellRouter
    ├── Positions  → Discover wallet PositionManager NFTs: add, remove in-kind, collect fees
    └── Protocol   → Complete policy disclosures & active deployed contracts registry
        │
        ▼
2. Client & Wallet Security Layer
    ├── Viem 2.57.11 client pinned strictly to Chain ID 4663
    ├── Realtime simulation preflight (`simulateContract`) before prompt
    └── Responsive Animated Transaction Modal with Blockscout explorer links
        │
        ▼
3. Onchain Protocol Execution
    ├── [A. Create Pool]  → BellPoolFactory.createAndSeed
    │                        ├── HookDeployer mines CREATE2 salt with 0x2CC0 flags
    │                        ├── PoolManager initializes pool key & tick spacing (60)
    │                        └── PositionManager mints noncustodial ERC-721 NFT
    ├── [B. Swap]         → BellRouter.swap
    │                        ├── Hook beforeSwap reads SessionRegistry + Calendar
    │                        ├── Hook sets dynamic session fee (0.05% - 1.00%)
    │                        ├── AMM executes swap with slippage protection
    │                        └── Hook afterSwap verifies per-trade and rolling flow caps
    └── [C. Liquidity]    → PositionManager.modifyLiquidities
                             └── Add liquidity, in-kind exit, or collect fees
        │
        ▼
4. Onchain Verification & Status
    ├── Blockscout block explorer verification on Robinhood Chain
    ├── Cloudflare Worker (`bell-keeper-b`) live directory indexing
    └── Transparent mainnet snapshot & contract bytecode verification
```

---

## 4. Key Architectural Components

### A. Core Smart Contracts (`contracts/src/`)

- **`BellPoolFactory.sol` (`0xf677ed…0a5b`):**
  Upgraded factory deploying isolated immutable hook templates, configuring per-pool flow caps, collecting standard 49 USDG service fees, and executing atomic seeding.
- **`BellRouter.sol` (`0x178d78…16d5`):**
  Front-facing router executing exact-input and exact-output swaps through Uniswap v4 PoolManager with onchain slippage, nonce validation, and deadline checks.
- **`BellHook.sol` (CREATE2 template flags `0x2CC0`):**
  `beforeInitialize | beforeSwap | afterSwap | beforeAddLiquidity`. Dynamic fee provider, flow budget enforcer, and market phase gate.
- **`BellPolicyOracle.sol` (`0x908bea…d335`):**
  Single staticcall oracle aggregating dependency reads across calendars, assets, and Chainlink session feeds into one authoritative `Output` struct.
- **`BellModeEvaluator.sol` (`0xEBDb22…77F4`):**
  State machine classifying pool conditions into `ACTIVE`, `CLOSED`, `HALTED`, or `RECOVERING`, deriving closure budgets from pool principal.
- **`BellPolicyDependencyReader.sol` (`0xe5D8c6…0CE3`):**
  Low-level bounded staticcall reader guaranteeing that failed external calls record explicit `ReasonBits` rather than silent fallback defaults.
- **`CalendarRegistry.sol` (`0x394983…05a3`):**
  Cryptographic Merkle tree storage for NYSE calendar intervals, early close days, and weekend closures.
- **`AssetRegistry.sol` (`0x0d9c0c…18c6`):**
  Authoritative directory of canonical Robinhood Stock Tokens and counterassets with bytecode fingerprints and capability bitmasks.
- **`SessionRegistry.sol` (`0x5f1b02…3795`):**
  Session feed history, observation checkpoints, and verified close anchors for scheduled closures.
- **`SafetyController.sol` (`0x7243cf…a179`):**
  Role-separated circuit breaker with distinct governance, guardian, and treasury accounts for limited pause and delayed resumption.

### B. Canonical Dependencies & Token Infrastructure

- **Uniswap v4 PoolManager (`0x8b26FE…87B56`):** Canonical AMM core singleton.
- **Uniswap v4 PositionManager (`0x84da24…9B662D`):** Noncustodial ERC-721 position manager.
- **Canonical Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`):** Signature-based token allowance router.
- **WETH (`0x0Bd7D3…cAD73`):** Wrapped Ether for native gas token pairs.
- **USDG (`0x5fc536…d1168`):** Canonical 6-decimal stablecoin and factory service fee currency.

### C. Web Application & Middleware (`apps/web/`, `workers/keeper-b/`)

- Next.js 16 App Router interface styled in an institutional market-terminal aesthetic.
- Fully responsive across desktop, tablet, and mobile viewports with zero horizontal overflow.
- 2-column animated transaction execution modal rendering real-time step pipelines for create, swap, and LP flows.
- Cloudflare Worker (`bell-keeper-b.asysyifaq25.workers.dev`) providing public CORS-enabled `/pools` indexing and `/status` reporting.

---

## 5. Technology Stack

- **Smart Contract Language:** Solidity `0.8.26` (Cancun EVM, viaIR)
- **AMM Infrastructure:** Uniswap v4 Core + Periphery
- **Target Network:** Robinhood Chain Mainnet (`Chain ID: 4663`)
- **Development Tooling:** Foundry (`forge 1.5.1`) + Native `solc`
- **Web Frontend:** Next.js `16.4.3` (App Router), React `19.3.1`, TypeScript `7.0.2`
- **Styling:** Tailwind CSS v4, Lucide Icons, GSAP `3.15`, Lenis `1.3`, Three.js `0.186`
- **Web3 Engine:** `viem 2.57.11`, `wagmi 2.19.5`, `@rainbow-me/rainbowkit 2.2.11`
- **Testing:** 993 total tests across Foundry (429 tests), `node:test` (484 tests), and Vitest (80 tests)
- **Deployment Platform:** Vercel Production (`https://bell-black.vercel.app`)

---

## 6. Live Mainnet Contract Addresses (Robinhood Chain 4663)

| Contract / Asset Name | Address | Category | Verification & Role |
|---|---|---|---|
| **BellPoolFactory** | `0xf677edc6346be53686E6DD42374A744cab9d0A5B` | Core Protocol | Upgraded factory (CREATE2 deployer & pool initializer) |
| **BellRouter** | `0x178d78419e8b7cd1f5e1e4a65f71d86c7f6516d5` | Core Protocol | Execution router for exact-in and exact-out swaps |
| **Uniswap v4 PoolManager** | `0x8b26fefa276860592d45114cb30b335dddd87b56` | Core Protocol | Canonical Uniswap v4 AMM state singleton |
| **Uniswap v4 PositionManager** | `0x84da249aafa359886c6a2ae1ebdc78a6059b662d` | Core Protocol | Canonical ERC-721 NFT position manager |
| **BellHookDeployer** | `0x3e5cEBb068ac71D742f700Db918908a15B8c45C5` | Core Protocol | Deterministic CREATE2 deployer for permission mask `0x2CC0` |
| **BellPolicyOracle** | `0x908bea5cd3C5297Ad69aCb19279c413d594cd335` | Registries & Oracles | Aggregated staticcall policy oracle |
| **BellModeEvaluator** | `0xEBDb2291f07F10490E7f34a5cD5C37dF95F877F4` | Registries & Oracles | Dynamic session fee & closure budget engine |
| **BellPolicyDependencyReader** | `0xe5D8c6Ba18589a71a89D11c54B9E03806A260CE3` | Registries & Oracles | Low-level bounded staticcall reader |
| **AssetRegistry** | `0x0d9c0c8b2065b08a8ad4abc861eb128385ef18c6` | Registries & Oracles | Directory of admitted stock tokens and counterassets |
| **CalendarRegistry** | `0x394983bff2715d57197389f323d807b0d61c05a3` | Registries & Oracles | Merkle-committed exchange session intervals |
| **SessionRegistry** | `0x5f1b0212dc6167cbc1883f910640a685b1243795` | Registries & Oracles | Onchain session feed tracking & close anchors |
| **SafetyController** | `0x7243cf13f0308edd4a0397551042fea3cf9da179` | Registries & Oracles | Emergency circuit breaker (governance, guardian, treasury) |
| **Permit2** | `0x000000000022d473030f116ddee9f6b43ac78ba3` | Registries & Oracles | Canonical signature approval router |
| **Apple Inc. (AAPL)** | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | Admitted Token | Canonical Robinhood Stock Token (18 decimals) |
| **NVIDIA Corporation (NVDA)** | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | Admitted Token | Canonical Robinhood Stock Token (18 decimals) |
| **Tesla, Inc. (TSLA)** | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | Admitted Token | Canonical Robinhood Stock Token (18 decimals) |
| **Global Dollar (USDG)** | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | Admitted Token | Canonical stablecoin & factory fee token (6 decimals) |
| **Wrapped Ether (WETH)** | `0x0bd7d308f8e1639fab988df18a8011f41eacad73` | Admitted Token | Canonical Wrapped Ether (18 decimals) |
| **Community Token (MEME)** | `0x385F4f8ae47651ce5F58F5265395a669f8281e18` | Admitted Token | Market-price only counterasset (18 decimals) |
| **Governance Deployer** | `0x6c3659988bd5f9e94f927b3fd7d0ee3746f8d399` | System Account | Protocol deployer & initialization admin |
| **Protocol Treasury** | `0xf6e272fbf862ae055949c61bc41e6395dfe20841` | System Account | Multi-signature treasury safe |
| **Service Recipient** | `0x58cd82a008cb9a6c0c605991b40a09bd6aa1a6fc` | System Account | Designated pool factory service fee recipient |

---

## 7. Security, Trust & Risk Controls

1. **Noncustodial Vault Architecture:**
   BELL smart contracts never hold custodial control over user funds. Liquidity positions are represented by transferable Uniswap v4 PositionManager ERC-721 NFTs owned directly in user wallets.
2. **Unblockable In-Kind Exits:**
   The `BellHook` architecture intentionally omits `beforeRemoveLiquidity` and `afterRemoveLiquidity` hook permissions. Liquidity providers can remove their liquidity in-kind at any time, even during market closures, feed outages, or emergency safety pauses.
3. **Fail-Closed by Design:**
   Whenever external data dependencies (feed freshness, exchange calendar proof, token admission) are absent, ambiguous, or stale, the hook strictly reverts swap execution instead of guessing.
4. **Permanent Pool Isolation:**
   Each pool hook is an independent, immutable contract deployed via CREATE2. Config parameters, pool class, and flow caps are cryptographically hashed into `configHash` at inception and cannot be modified post-deployment.
5. **Loss-of-Funds Indexing:**
   The smart contract test suite includes `LossOfFundsIndex.t.sol`, formally verifying 27 specific exploit and loss-of-funds vectors (reentrancy, settlement residue, cap bypass, closure overruns, and frontrunning).
6. **Transparent Status Disclosures:**
   All product UI surfaces explicitly disclose that independent third-party smart contract audits are incomplete, without making false assertions or promising risk-free yields.
