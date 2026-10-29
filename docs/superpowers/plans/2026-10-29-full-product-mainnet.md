# BELL Full-Product Mainnet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full BELL product scope on the live mainnet stack — multi-asset admission (AAPL/NVDA/TSLA), all supported sessions, `PRICE_GUARDED` via free onchain Chainlink Data Feeds, multi-asset keeper, pools per brief pair matrix, and acceptance — in one continuous push.

**Architecture:** Keep the deployed mainnet protocol stack (10 contracts at the recorded addresses) intact. Extend the existing adapter/keeper/admission tooling from single-asset AAPL to the three documented candidates, unlock `PRICE_GUARDED` in `BellPoolFactory` using immutable Chainlink feed references, and add a per-asset multi-feed reference adapter that reads `AggregatorV3Interface` onchain. Sessions follow the existing calendar; phases without a valid source fail closed (overnight has no Yahoo feed and stays untradeable).

**Tech Stack:** Solidity 0.8.26 + Foundry; viem-based deploy/admission/keeper scripts; Cloudflare Worker keeper-b; Node test runner; existing `docs/BELL-Developer-Brief-Final.md` policy tables.

## Global Constraints

- Chain: Robinhood Chain mainnet 4663. Deployed stack addresses come from `evidence/deploy/mainnet-4663.json`; never use testnet evidence addresses.
- Governance delay stays `0` per owner decision. No timelock, no multi-hour waits; calendar keeps its existing 5-minute activation buffer.
- Brief `canaryMayNarrowImplementationScope: false` remains; this plan implements the full pair matrix, not a pilot.
- Owner decision (2026-10-29): the four-weekend availability gate and Yahoo data-rights gating are **removed from the brief** and must not gate implementation. Yahoo is used as an active price source under this decision; entitlement checks are no longer a blocker.
- Yahoo provides PRE/REGULAR/POST only. There is no Yahoo overnight feed; OVERNIGHT pools stay fail-closed rather than trading without data.
- `PRICE_GUARDED` reference prices come from free onchain Chainlink Data Feeds on 4663 (`AggregatorV3Interface`, 8 decimals, 86400s heartbeat). Feed price is already multiplier-adjusted token price; never multiply by `uiMultiplier()` twice.
- Feed heartbeat governs reference staleness for `PRICE_GUARDED` (86400s), not the 120s Yahoo report freshness bound.
- If a feed is paused (`oraclePaused()` on the token), missing, or exceeds its heartbeat, the pool halts for that leg; never substitute a fabricated price.
- Chainlink Data Streams credentials in `.env` are not used by this plan (they belong to the retired paid path).
- BELL has no platform token; fee token on mainnet is USDG. `mBELL` is testnet-only.
- Every change is TDD: failing test first, minimal implementation, all suites green before commit.

---

### Task 1: Owner Decision — Drop the Four-Weekend Gate and Yahoo Rights Gating

**Files:**
- Modify: `docs/BELL-Developer-Brief-Final.md`
- Modify: `config/release-baseline.json`
- Modify: `config/sources/rights-status.json`
- Modify: `evidence/release-index.json`
- Test: `scripts/evidence/check-policy-constants.mjs` (no change) + a new snapshot test

**Interfaces:**
- Consumes: current brief text, `rights-status.json` schema, `release-index.json` gates
- Produces: brief with the four-weekend gate and Yahoo-rights gating marked removed by owner decision; `rights-status.json` reflecting the owner decision; release gates no longer blocked by those items

- [ ] **Step 1: Write failing test asserting the decision is recorded**

```js
// scripts/evidence/owner-scope-decision.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const brief = readFileSync('docs/BELL-Developer-Brief-Final.md', 'utf8');
const baseline = JSON.parse(readFileSync('config/release-baseline.json', 'utf8'));
const rights = JSON.parse(readFileSync('config/sources/rights-status.json', 'utf8'));

test('owner decision removes the four-weekend availability gate', () => {
  assert.match(brief, /Decision 2026-10-29: the four-weekend availability gate is removed by owner decision/);
  assert.equal(baseline.mandate.fourWeekendAvailabilityGate, false);
});

test('owner decision lifts Yahoo rights gating as a production blocker', () => {
  assert.match(brief, /Decision 2026-10-29: Yahoo data-rights gating is removed as a production blocker by owner decision/);
  assert.equal(rights.gating.productionBlocker, false);
  assert.equal(rights.status, 'OWNER_ACCEPTED_RISK');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/evidence/owner-scope-decision.test.mjs`
Expected: FAIL — no decision text in brief, no new baseline/rights fields.

- [ ] **Step 3: Apply the decision to the brief, baseline, and rights file**

In `docs/BELL-Developer-Brief-Final.md`, replace the four-weekend availability gate paragraph (the one beginning `Data capture seluruh sesi dan minimal empat weekend diperiksa…`) with:

```markdown
**Decision 2026-10-29: the four-weekend availability gate is removed by owner decision.** Availability evidence is
still collected and reported honestly, but it is no longer a release-blocking gate. Overnight remains fail-closed
because no Yahoo overnight feed exists; this is a data constraint, not a gate.
```

Directly after it, add:

```markdown
**Decision 2026-10-29: Yahoo data-rights gating is removed as a production blocker by owner decision.** Yahoo
Finance charts are used as the active session price source signed by the BELL reporter. Rights fields are kept as
disclosure, not gates; redistribution of raw Yahoo reports remains disallowed.
```

In `config/release-baseline.json`, inside `mandate`, add `"fourWeekendAvailabilityGate": false`.

In `config/sources/rights-status.json`, add `"gating": { "productionBlocker": false }` and change `"status"` to `"OWNER_ACCEPTED_RISK"`. Keep the existing per-right fields as disclosure.

In `evidence/release-index.json`, set each E-gate value that referenced the removed gates so `E05` no longer lists the Yahoo entitlement requirement; update its `note` to record the owner decision date.

- [ ] **Step 4: Run test to verify it passes and run related gates**

Run: `node --test scripts/evidence/owner-scope-decision.test.mjs`
Expected: PASS (2 tests).

Run: `pnpm evidence:check && pnpm policy:check`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/BELL-Developer-Brief-Final.md config/release-baseline.json config/sources/rights-status.json evidence/release-index.json scripts/evidence/owner-scope-decision.test.mjs
git commit -m "Owner decision: drop four-weekend gate and Yahoo rights gating"
```

---

### Task 2: PRICE_GUARDED Reference Adapter (onchain Chainlink feeds)

**Files:**
- Create: `contracts/src/adapters/ChainlinkTokenReferenceAdapter.sol`
- Create: `contracts/test/unit/adapters/ChainlinkTokenReferenceAdapter.t.sol`
- Modify: `contracts/src/interfaces/IBellProtocol.sol` (only if a shared interface must be exported; reuse `ISourceAdapterIdentity` if present)

**Interfaces:**
- Consumes: `AggregatorV3Interface.latestRoundData()` on chain 4663; `PolicyConstants.MAX_REPORT_AGE_SECONDS` is NOT used here — reference staleness is the feed heartbeat.
- Produces: adapter returning a fresh 18-decimal reference price for one token via `reference()` (uint128, 1e18 scale), `heartbeat()` (uint32, configured), `symbol()` (string), and the existing identity surface (`sourceConfigHash`, `fingerprint`). Reverts `StaleReference()` when `now - updatedAt > heartbeat`, `ReferenceUnavailable()` when the feed answers zero or is read-paused via `oraclePaused()` on the paired token.

- [ ] **Step 1: Write the failing adapter test**

```solidity
// contracts/test/unit/adapters/ChainlinkTokenReferenceAdapter.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ChainlinkTokenReferenceAdapter} from "../../../src/adapters/ChainlinkTokenReferenceAdapter.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract StubAggregator is AggregatorV3Interface {
    int256 public answer; uint256 public updatedAt; uint8 public dec;
    constructor(int256 a, uint256 t, uint8 d) { answer = a; updatedAt = t; dec = d; }
    function decimals() external view returns (uint8) { return dec; }
    function description() external view returns (string memory) { return "stub"; }
    function version() external view returns (uint256) { return 1; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract StubStockWithPause {
    bool public oraclePaused;
    function setPaused(bool p) external { oraclePaused = p; }
}

contract ChainlinkTokenReferenceAdapterTest is Test {
    function test_scales_feed_answer_to_1e18() public {
        StubAggregator agg = new StubAggregator(350_73393114, block.timestamp, 8); // $350.73
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(
            address(agg), 86400, 8, "Robinhood AAPL / USD", address(0)
        );
        assertEq(a.reference(), 350_73393114 * 1e10);
        assertEq(a.heartbeat(), 86400);
    }

    function test_reverts_when_older_than_heartbeat() public {
        StubAggregator agg = new StubAggregator(100, block.timestamp - 86401, 8);
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(0));
        vm.expectRevert(ChainlinkTokenReferenceAdapter.StaleReference.selector);
        a.reference();
    }

    function test_reverts_when_token_oracle_paused() public {
        StubAggregator agg = new StubAggregator(100, block.timestamp, 8);
        StubStockWithPause stock = new StubStockWithPause();
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(stock));
        stock.setPaused(true);
        vm.expectRevert(ChainlinkTokenReferenceAdapter.ReferenceUnavailable.selector);
        a.reference();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --root contracts --match-path 'test/unit/adapters/ChainlinkTokenReferenceAdapter.t.sol' -vv`
Expected: FAIL — `ChainlinkTokenReferenceAdapter` does not exist.

- [ ] **Step 3: Implement the minimal adapter**

```solidity
// contracts/src/adapters/ChainlinkTokenReferenceAdapter.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

interface ITokenOraclePause { function oraclePaused() external view returns (bool); }

contract ChainlinkTokenReferenceAdapter {
    error StaleReference();
    error ReferenceUnavailable();
    error BadConfig();

    AggregatorV3Interface public immutable feed;
    uint32 public immutable heartbeat;
    uint8 public immutable feedDecimals;
    string public immutable symbol;
    address public immutable stockToken;

    constructor(address feed_, uint32 heartbeat_, uint8 feedDecimals_, string memory symbol_, address stockToken_) {
        if (feed_ == address(0) || heartbeat_ == 0 || feedDecimals_ > 18) revert BadConfig();
        feed = AggregatorV3Interface(feed_);
        heartbeat = heartbeat_;
        feedDecimals = feedDecimals_;
        symbol = symbol_;
        stockToken = stockToken_;
    }

    /// @notice Latest feed price scaled to 1e18. Feed answers are already multiplier-adjusted.
    function reference() public view returns (uint128) {
        if (stockToken != address(0) && ITokenOraclePause(stockToken).oraclePaused()) revert ReferenceUnavailable();
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0) revert ReferenceUnavailable();
        if (block.timestamp - updatedAt > heartbeat) revert StaleReference();
        uint256 scaled = feedDecimals <= 18
            ? uint256(answer) * 10 ** (18 - feedDecimals)
            : uint256(answer) / 10 ** (feedDecimals - 18);
        require(scaled <= type(uint128).max, "overflow");
        return uint128(scaled);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --root contracts --match-path 'test/unit/adapters/ChainlinkTokenReferenceAdapter.t.sol' -vv`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/adapters/ChainlinkTokenReferenceAdapter.sol contracts/test/unit/adapters/ChainlinkTokenReferenceAdapter.t.sol
git commit -m "Add Chainlink onchain reference adapter for PRICE_GUARDED"
```

---

### Task 3: Unlock PRICE_GUARDED in BellPoolFactory with Reference Anchoring

**Files:**
- Modify: `contracts/src/BellPoolFactory.sol`
- Modify: `contracts/src/BellHook.sol` (store reference adapter addresses per side)
- Modify: `contracts/src/types/ProtocolTypes.sol` (PoolConfig gains `referenceAdapter0`/`referenceAdapter1` addresses)
- Modify: `contracts/test/integration/factory/BellPoolFactory.t.sol`
- Test: `contracts/test/integration/factory/PriceGuardedCreation.t.sol` (new)

**Interfaces:**
- Consumes: `ChainlinkTokenReferenceAdapter.reference()` from Task 2; `_profileHash` from `mainnet-pool-config.mjs`
- Produces: factory accepts `poolClass == 0` when both sides have reference adapters and the initial pool price sits inside `ACTIVE_BAND_BPS` of the feed-derived reference; hook exposes `referenceAdapter0/1` for the oracle; `PRICE_GUARDED` creation no longer reverts `PriceGuardUnavailable` when configured correctly.

- [ ] **Step 1: Write the failing factory test**

```solidity
// contracts/test/integration/factory/PriceGuardedCreation.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ChainlinkTokenReferenceAdapter} from "../../../src/adapters/ChainlinkTokenReferenceAdapter.sol";

contract PriceGuardedCreationTest is Test {
    function test_reference_band_accepts_initial_price_within_bps() public {
        // reference = 1e18-scale price; sqrtPrice derived from same ratio must pass.
        uint128 reference = 350_73393114 * 1e10;
        uint256 bandBps = 200; // ACTIVE_BAND_BPS placeholder; use PolicyConstants value in impl
        uint160 sqrtPrice = _sqrtFromRatio(reference, 1e18);
        assertTrue(_withinBand(sqrtPrice, reference, 1e18, bandBps));
    }

    function _sqrtFromRatio(uint256 p0, uint256 p1) internal pure returns (uint160) {
        return uint160(Math.sqrt((p0 * 1e18 * 2 ** 192) / p1 / 1e18));
    }

    function _withinBand(uint160 sqrtPrice, uint256 p0, uint256 p1, uint256 bandBps) internal pure returns (bool) {
        uint256 ratio = (uint256(sqrtPrice) * uint256(sqrtPrice) * 1e18) >> 192;
        uint256 upper = (p0 * 1e18 * (10000 + bandBps)) / (p1 * 10000);
        uint256 lower = (p0 * 1e18 * (10000 - bandBps)) / (p1 * 10000);
        return ratio >= lower && ratio <= upper;
    }
}
```

(Real test in the plan uses the production `BellPoolFactory.createAndSeed` against the existing fixtures in `BellPoolFactory.t.sol`; the snippet above is the band-math kernel the factory reuses.)

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --root contracts --match-path 'test/integration/factory/PriceGuardedCreation.t.sol' -vv`
Expected: FAIL — band helper not implemented yet.

- [ ] **Step 3: Implement**

1. `ProtocolTypes.PoolConfig` gains `address referenceAdapter0; address referenceAdapter1;` (zero means “no reference on this side”). `_profileHash` must keep these fields in the hash so request/factory mismatch fails closed.
2. `BellPoolFactory._validate`: replace `if (r.config.poolClass == 0) revert PriceGuardUnavailable();` with:
   - if `poolClass == 0`: require both reference adapters non-zero and `address(referenceAdapter).code.length > 0`; require `stock0 != stock1` OR both stock (stock/stock allowed in PRICE_GUARDED); call `ChainlinkTokenReferenceAdapter(referenceAdapter).reference()` for both sides, derive the reference raw ratio `(P0*10^d1)/(P1*10^d0)`, and require the initial `sqrtPriceX96` to sit inside `PolicyConstants.ACTIVE_BAND_BPS`. Fail closed with `InitialPriceOutOfBand` otherwise.
3. `BellHook` constructor stores `_referenceAdapter0/1` from config; `_policyInput()` populates them; `BellPolicyOracle` uses them to fill `output.referencePrice18` per side when `poolClass == PRICE_GUARDED`, calling `reference()` (halting with a recorded reason if it reverts).
4. `_profileHash` derivation in `scripts/deploy/mainnet-pool-config.mjs` is updated to match the new struct shape (same field order as Solidity).

- [ ] **Step 4: Run tests**

Run: `forge test --root contracts`
Expected: all suites green including the new PRICE_GUARDED creation tests and existing SESSION_ONLY suites (no regressions).

Run: `node --test scripts/deploy/*.test.mjs`
Expected: green including the updated profile-hash tests.

- [ ] **Step 5: Commit**

```bash
git add contracts/src contracts/test scripts/deploy/mainnet-pool-config.mjs scripts/deploy/mainnet-pool-config.test.mjs
git commit -m "Unlock PRICE_GUARDED with onchain Chainlink reference feeds"
```

---

### Task 4: Multi-Asset Mainnet Configuration and Admission Runner

**Files:**
- Modify: `scripts/deploy/mainnet-yahoo-stack.mjs` (loop over `candidates.mainnet.json` assets)
- Modify: `scripts/deploy/mainnet-admit-assets.mjs` (admit WETH + all configured stocks with capability mask including POST)
- Modify: `scripts/deploy/mainnet-calendar.mjs` (build a root per stock asset)
- Create: `scripts/deploy/mainnet-multi-asset.test.mjs`
- Create: `evidence/deploy/mainnet-4663-stock-adapters.json` (produced at run time, one block per symbol)

**Interfaces:**
- Consumes: `config/assets/candidates.mainnet.json` (AAPL/NVDA/TSLA tokens + feed proxies), deployed manifest
- Produces: per-symbol adapter evidence with `symbol`, `stockToken`, `directAdapter`, `regularAdapter`, `extendedAdapter`, `chainlinkReferenceAdapter`, wire hashes; an asset-queue JSON listing every admitted descriptor ID

- [ ] **Step 1: Write the failing multi-asset config test**

```js
// scripts/deploy/mainnet-multi-asset.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const candidates = JSON.parse(readFileSync('config/assets/candidates.mainnet.json', 'utf8'));
const runner = readFileSync('scripts/deploy/mainnet-yahoo-stack.mjs', 'utf8');

test('yahoo stack targets every documented candidate, not just BELL_MAINNET_SYMBOL', () => {
  const symbols = candidates.assets.map((a) => a.symbol);
  assert.deepEqual(symbols, ['AAPL', 'NVDA', 'TSLA']);
  assert.match(runner, /candidates\.assets/);
  assert.doesNotMatch(runner, /const symbol = \(env\.BELL_MAINNET_SYMBOL/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/deploy/mainnet-multi-asset.test.mjs`
Expected: FAIL — runner still keys off `BELL_MAINNET_SYMBOL`.

- [ ] **Step 3: Implement multi-asset loop**

1. `mainnet-yahoo-stack.mjs`: iterate `candidates.assets`; for each symbol deploy direct/regular/extended adapters and one `ChainlinkTokenReferenceAdapter` bound to that symbol's `directAdjustedTokenUsd.proxy`, heartbeat 86400, decimals 8, stock token address for the pause guard. Write all results into one evidence file keyed by symbol.
2. `mainnet-admit-assets.mjs`: after WETH, loop the candidate list; capability mask becomes `PRE|REGULAR|POST` (`0b1110`) for every stock; source config wires direct+regular+extended; the stock descriptor's `tokenPriceAdapter` is the direct adapter, `regularAdapter`/`extendedAdapter` per phase, and the new reference adapter is recorded in evidence (registry descriptor schema unchanged this task).
3. `mainnet-calendar.mjs`: accept `--asset=<descriptorId>` or build one root per admitted stock, each with its own state file, so activation is per-asset resumable.

- [ ] **Step 4: Run tests**

Run: `node --test scripts/deploy/mainnet-multi-asset.test.mjs scripts/deploy/*.test.mjs`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy/mainnet-yahoo-stack.mjs scripts/deploy/mainnet-admit-assets.mjs scripts/deploy/mainnet-calendar.mjs scripts/deploy/mainnet-multi-asset.test.mjs
git commit -m "Multi-asset mainnet admission and calendar runners"
```

---

### Task 5: Multi-Asset Keeper

**Files:**
- Modify: `workers/keeper-b/src/index.ts`
- Modify: `workers/keeper-b/src/tick-policy.mjs`
- Modify: `workers/keeper-b/wrangler.jsonc`
- Test: `workers/keeper-b/test/multi-asset.test.ts` (new)

**Interfaces:**
- Consumes: `evidence/deploy/mainnet-4663-stock-adapters.json` (per-symbol wires), `BELL_STOCK_ASSETS` env (JSON array of `{symbol, assetId}`)
- Produces: one tick publishes a direct + phase-matched stream report for **every** configured asset whose calendar phase has a Yahoo source; overnight/CLOSED assets are skipped with recorded reasons; `/status` reports per-asset last publish

- [ ] **Step 1: Write the failing keeper test**

```ts
// workers/keeper-b/test/multi-asset.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return { ...actual,
    createPublicClient: () => ({
      getChainId: async () => 4663,
      readContract: async ({ functionName }) => {
        if (functionName === 'currentInterval') return { assetId: `0x${'11'.repeat(32)}`, phase: 2, start: 0n, end: 9n };
        throw new Error('unexpected read');
      },
    }),
    createWalletClient: () => ({ writeContract: async () => '0x'.padEnd(66, '1') }),
    http: (u) => ({ url: u }),
  };
});

const { runTick } = await import('../src/index');

describe('multi-asset keeper tick', () => {
  it('publishes for every configured asset with an eligible phase', async () => {
    const assets = [{ symbol: 'AAPL', assetId: `0x${'11'.repeat(32)}` }, { symbol: 'NVDA', assetId: `0x${'22'.repeat(32)}` }];
    const result = await runTick(baseEnv(assets), { nowSeconds: 1_800_000_000, fetchQuote: async (s) => ({ phase: 'REGULAR', observedAt: 1_799_999_950, priceRaw18: '1000000000000000000', ageSeconds: 1, [s === 'NVDA' ? 'symbol' : 'symbol']: s }) });
    expect(result.publishedSymbols.sort()).toEqual(['AAPL', 'NVDA']);
  });
});
```

(Full fixture mirrors `workers/keeper-b/test/chain-config.test.ts` mocking; the assertion is that the tick loops assets instead of hardcoding one `BELL_STOCK_ASSET_ID`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bell/keeper-b test`
Expected: FAIL — keeper reads a single `BELL_STOCK_ASSET_ID`.

- [ ] **Step 3: Implement the loop**

1. `wrangler.jsonc` adds `BELL_STOCK_ASSETS` (JSON string). `BELL_STOCK_ASSET_ID` stays as a fallback for backward compatibility.
2. `runTick` resolves the asset list once, then for each asset: read its calendar interval, resolve the phase wire from that asset's adapters, fetch `fetchYahooChartQuote(symbol)`, enforce phase/freshness, sign and publish direct+stream+refreshHealth. Per-asset failures are recorded and do not abort the loop.
3. `/status` gains `assets: [{symbol, assetId, lastPublishAt, lastReason}]`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bell/keeper-b test`
Expected: all keeper tests green including the new multi-asset suite.

- [ ] **Step 5: Commit**

```bash
git add workers/keeper-b
git commit -m "Keeper publishes every configured mainnet asset per tick"
```

---

### Task 6: Reference-Bound Hooks, Pools, and Live PRICE_GUARDED Acceptance

**Files:**
- Modify: `scripts/deploy/mainnet-create-pool.mjs` (accept poolClass 0 with reference adapters; derive reference from live feeds at creation time)
- Modify: `scripts/deploy/mainnet-acceptance.mjs` (per-pool class expectations)
- Modify: `scripts/deploy/mainnet-keeper-config.mjs` (include reference adapters)
- Create: `evidence/deploy/mainnet-4663-pool-<PAIR>.json` (runtime output per pool)

**Interfaces:**
- Consumes: Tasks 2–5 outputs; deployed factory/hook stack
- Produces: one `PRICE_GUARDED` pool per brief pair (USDG/AAPL, USDG/NVDA, USDG/TSLA, WETH/AAPL, WETH/NVDA, WETH/TSLA) plus `SESSION_ONLY` variants where the counterasset has no reference; acceptance evidence per pool

- [ ] **Step 1: Extend pool creation preflight**

In `mainnet-create-pool.mjs`, when `BELL_POOL_CLASS=0`: read both reference adapters' `reference()` at creation time, derive the initial `sqrtPriceX96` from the two feed prices so the opening price sits inside `ACTIVE_BAND_BPS`, and pass the adapters through `PoolConfig`. The pool-config helper gains a pure `deriveInitialSqrtPrice({price0_18, price1_18})` function with a unit test asserting monotonicity and band containment.

- [ ] **Step 2: Update acceptance for both classes**

`mainnet-acceptance.mjs` gains: for `PRICE_GUARDED`, assert `hookConfig.poolClass == 0`, both `referenceAdapter` addresses have code, a live `reference()` read succeeds and its band check passes at verification time; for `SESSION_ONLY`, assert `referencePrice18` stays zero in policy output.

- [ ] **Step 3: Run the full local gate**

Run: `pnpm test:contracts && node --test scripts/deploy/*.test.mjs && pnpm --filter @bell/keeper-b test && pnpm evidence:check`
Expected: all green.

- [ ] **Step 4: Broadcast the new deployment**

Run: `node scripts/deploy/deploy-mainnet.mjs --broadcast` (only after the balance preflight passes with the measured stack cost plus the new factory/hook/oracle changes).

- [ ] **Step 5: Execute mainnet sequence per asset**

For each of AAPL/NVDA/TSLA:
1. `pnpm mainnet:yahoo-stack:broadcast`
2. `pnpm mainnet:admit:queue && pnpm mainnet:admit:activate`
3. `pnpm mainnet:calendar:queue && pnpm mainnet:calendar:activate-root && pnpm mainnet:calendar:activate-interval`
4. Keeper publish until `health.ready`
5. `pnpm mainnet:pool:broadcast` for each pair
6. `pnpm mainnet:swap` per pair
7. `pnpm mainnet:acceptance` per pool

- [ ] **Step 6: Record evidence and commit**

```bash
git add evidence/deploy docs/MAINNET-DEPLOY.md
git commit -m "Full-product mainnet evidence: multi-asset pools and acceptance"
```

---

### Task 7: Honest Release-Gate Update

**Files:**
- Modify: `evidence/releases/index.json`
- Modify: `evidence/release-index.json`
- Modify: `docs/MAINNET-DEPLOY.md`

**Interfaces:**
- Consumes: Task 1 decision, Task 6 evidence
- Produces: release gates reflecting actual state; no gate marked PASS without its artifact

- [ ] **Step 1: Update gates truthfully**

Set E-gates that now have real artifacts to their actual status with evidence paths; leave gates without artifacts as `NOT_RUN`. Remove references to the dropped four-weekend/Yahoo-rights gates from blocker lists; add a `ownerDecisions` array recording the 2026-10-29 removals with the commit hash.

- [ ] **Step 2: Verify and commit**

Run: `pnpm evidence:check && node --test scripts/evidence/*.test.mjs`
Expected: green.

```bash
git add evidence docs
git commit -m "Release gates reflect mainnet full-product evidence and owner decisions"
```

---

## Explicit Non-Goals (must not be claimed by this plan)

- Overnight trading: Yahoo has no overnight feed; OVERNIGHT stays fail-closed. No fabricated anchor.
- Statistical safety claims from long observation windows: not produced by this plan.
- Independent security audit: remains owner-waived per `evidence/release-index.json`; this plan does not generate audit evidence.
- `MEME/NVDA`: no MEME token address exists in the candidate config; that pair remains unimplementable until an address is supplied.
