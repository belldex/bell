# End-to-End Testnet Execution Plan: Pool Creation & Live Swap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve full end-to-end execution on Robinhood Testnet (Chain 46630): deploy upgraded protocol stack with `BellPolicyOracle`, admit WETH and Rehearsal Stock Token on `AssetRegistry`, configure `CalendarRegistry` and publish fresh Yahoo reporter-attested price reports to `SessionRegistry`, create and seed the first live liquidity pool via `BellPoolFactory`, and execute the first onchain swap through `BellRouter`.

**Architecture:**
- `BellHook` runs with `SWAP_EXECUTION_READY = true` using `BellPolicyOracle` (via `STATICCALL`) to evaluate session policy, dynamic fees, and flow budgets within EIP-170 limits.
- `AaplRehearsalStockToken` (ERC20 with corporate getters `uiMultiplier`, `newUIMultiplier`, `effectiveAt`, `oraclePaused`) serves as the testnet stock asset.
- `YahooAttestedSourceAdapter` (direct price + regular stream) relays reporter-signed quotes verified by `YahooSourceVerifier` on chain 46630.
- `CalendarRegistry` commits a valid REGULAR calendar interval, enabling `SessionRegistry.refreshHealth` to reach `ready = true` and `reasonBits = 0`.
- `BellPoolFactory.createAndSeed` atomically initializes the Uniswap v4 pool, seeds liquidity via `PositionManager`, and activates the hook to `LIVE`.
- `BellRouter.swap` executes a live swap onchain with dynamic session fee override and budget commit.

**Tech Stack:** Solidity 0.8.26, Foundry, Uniswap v4-core, OpenZeppelin Contracts, Node.js 24, viem 2.57.11.

## Global Constraints
- Target chain is Robinhood Testnet (chainId 46630).
- Compiler is solc 0.8.26; EVM version Cancun; optimizer runs 200.
- All signing credentials (`DEPLOYER_PRIVATE_KEY`, `YAHOO_REPORTER_PRIVATE_KEY`) are read from local `.env` and never logged or committed.
- All deployments and transactions must be verified onchain by reading receipts and state.

---

### Task 1: Rehearsal Stock Token Contract

**Files:**
- Create: `contracts/src/fixtures/AaplRehearsalStockToken.sol`
- Test: `contracts/test/unit/token/AaplRehearsalStockToken.t.sol`

**Interfaces:**
- Produces: `AaplRehearsalStockToken` inheriting OpenZeppelin `ERC20`, implementing `decimals() returns (uint8 18)`, `mint(address, uint256)`, and corporate getters: `uiMultiplier() returns (uint256 1e18)`, `newUIMultiplier() returns (uint256 1e18)`, `effectiveAt() returns (uint256 0)`, `oraclePaused() returns (bool false)`.

- [ ] **Step 1: Write the failing unit test**
Create `contracts/test/unit/token/AaplRehearsalStockToken.t.sol` testing ERC20 transfer, minting, 18 decimals, and corporate getters.

- [ ] **Step 2: Run test to verify it fails**
Run: `forge test --root contracts --match-path 'test/unit/token/AaplRehearsalStockToken.t.sol'`
Expected: FAIL (source file does not exist).

- [ ] **Step 3: Implement AaplRehearsalStockToken**
Write `contracts/src/fixtures/AaplRehearsalStockToken.sol`.

- [ ] **Step 4: Run test to verify it passes**
Run: `forge test --root contracts --match-path 'test/unit/token/AaplRehearsalStockToken.t.sol'`
Expected: PASS.

- [ ] **Step 5: Commit**
`git add contracts/src/fixtures/AaplRehearsalStockToken.sol contracts/test/unit/token/AaplRehearsalStockToken.t.sol`
`git commit -m "feat: add AaplRehearsalStockToken with Robinhood corporate getters"`

---

### Task 2: Deploy Upgraded Protocol Stack to Testnet

**Files:**
- Modify: `contracts/script/DeployTestnet.s.sol`
- Modify: `evidence/deploy/testnet-46630.json`
- Script: `scripts/deploy/deploy-testnet.mjs`

**Interfaces:**
- Consumes: `DeployTestnet.s.sol` deploying `SafetyController`, `AssetRegistry`, `CalendarRegistry`, `SessionRegistry`, `PoolManager`, `WETH`, `PositionManager`, `BellPolicyOracle`, `BellHookDeployer`, `BellPoolFactory`, `BellRouter`.
- Produces: Live verified addresses on Chain 46630 written to `evidence/deploy/testnet-46630.json`.

- [ ] **Step 1: Dry-run DeployTestnet script**
Run: `node scripts/deploy/deploy-testnet.mjs --dry-run`
Verify transaction sequence: 10 transactions deploying the full stack including `BellPolicyOracle`.

- [ ] **Step 2: Broadcast deployment to Testnet 46630**
Run: `node scripts/deploy/deploy-testnet.mjs`
Expected: 10 contracts successfully deployed and mined on chain 46630.

- [ ] **Step 3: Regenerate and verify onchain evidence**
Run: `node scripts/deploy/verify-testnet-deployment.mjs`
Run: `node scripts/deploy/check-testnet-addresses.mjs --rpc`
Expected: All addresses have code and bindings match manifest.

- [ ] **Step 4: Commit**
`git add contracts/script/DeployTestnet.s.sol evidence/deploy/testnet-46630.json evidence/deploy/testnet-46630-verification.json packages/protocol/src/testnet-status.mjs`
`git commit -m "feat(deploy): deploy upgraded protocol stack with BellPolicyOracle to testnet"`

---

### Task 3: Deploy Stock Token & Yahoo Adapters for Testnet

**Files:**
- Create: `scripts/deploy/deploy-testnet-stock-and-adapters.mjs`
- Evidence: `evidence/deploy/yahoo-verifier-adapter-testnet.json`

**Interfaces:**
- Consumes: `AaplRehearsalStockToken`, `YahooSourceVerifier` (deployed at `0x20a066123c260bc6c5253f75e261c5056fde4bea`), `buildYahooSourceWire`.
- Produces: Deployed `stockToken`, direct price adapter (`scope 0`), and regular stream adapter (`scope 1`) with verified `sourceConfigHash` and `feedId`.

- [ ] **Step 1: Write deployment script**
Implement `scripts/deploy/deploy-testnet-stock-and-adapters.mjs` that deploys `AaplRehearsalStockToken`, mints 1,000,000 tokens to deployer, builds SourceWires for chainId 46630, deploys direct adapter (scope 0) and regular stream adapter (scope 1).

- [ ] **Step 2: Run deployment script**
Run: `node scripts/deploy/deploy-testnet-stock-and-adapters.mjs`
Expected: Stock token and adapters deployed, verified onchain.

- [ ] **Step 3: Update evidence file**
Record addresses and tx hashes in `evidence/deploy/yahoo-verifier-adapter-testnet.json`.

- [ ] **Step 4: Commit**
`git add scripts/deploy/deploy-testnet-stock-and-adapters.mjs evidence/deploy/yahoo-verifier-adapter-testnet.json`
`git commit -m "feat(deploy): deploy testnet stock token and wire-bound Yahoo adapters"`

---

### Task 4: Admit WETH Counterasset & Stock Token on AssetRegistry

**Files:**
- Script: `scripts/deploy/admit-testnet-assets.mjs`
- Evidence: `evidence/deploy/testnet-46630-asset-queue.json`

**Interfaces:**
- Consumes: `AssetRegistry.queueAsset`, `AssetRegistry.activateAsset` (0 delay on chain 46630).
- Produces: Active descriptor IDs for WETH (`isStock = false`) and StockToken (`isStock = true`, capabilityMask = 0x1E).

- [ ] **Step 1: Write admission script**
Implement `scripts/deploy/admit-testnet-assets.mjs`:
- Queue & activate WETH (counterasset, empty sourceConfig)
- Queue & activate StockToken (stock descriptor with direct adapter + regular stream adapter, encoded SourceWire[])
- Verify `descriptorIdForToken` returns active IDs on `AssetRegistry`.

- [ ] **Step 2: Run admission script**
Run: `node scripts/deploy/admit-testnet-assets.mjs`
Expected: Both WETH and StockToken are ACTIVE in `AssetRegistry`.

- [ ] **Step 3: Commit**
`git add scripts/deploy/admit-testnet-assets.mjs evidence/deploy/testnet-46630-asset-queue.json`
`git commit -m "feat(deploy): admit WETH counterasset and stock descriptor on testnet AssetRegistry"`

---

### Task 5: Configure Calendar Root & Publish Price Reports

**Files:**
- Script: `scripts/deploy/setup-calendar-and-price.mjs`
- Script: `scripts/deploy/publish-yahoo-direct.mjs`

**Interfaces:**
- Consumes: `CalendarRegistry.queueRoot`, `activateRoot`, `activateInterval`, `YahooAttestedSourceAdapter.publishDirect`, `SessionRegistry.submitReports`, `SessionRegistry.refreshHealth`.
- Produces: `SessionRegistry.health(stockAssetId)` with `ready = true` and `reasonBits = 0`.

- [ ] **Step 1: Write calendar and price script**
Implement `scripts/deploy/setup-calendar-and-price.mjs`:
- Build a valid CalendarRoot and CalendarLeaf covering `[now - 1h, now + 24h]` with `phase = PHASE_REGULAR` (2).
- Queue and activate root on `CalendarRegistry` for `stockAssetId`.
- Activate interval with proof.
- Fetch fresh quote or build current sample, sign with `YAHOO_REPORTER_PRIVATE_KEY` for chainId 46630.
- Publish direct quote to direct adapter (`publishDirect`).
- Submit report to `SessionRegistry.submitReports`.
- Call `SessionRegistry.refreshHealth(stockAssetId)`.
- Assert `health.ready == true && health.reasonBits == 0`.

- [ ] **Step 2: Execute script on testnet**
Run: `node scripts/deploy/setup-calendar-and-price.mjs`
Expected: Calendar interval active, reports submitted, health ready with reasonBits = 0.

- [ ] **Step 3: Commit**
`git add scripts/deploy/setup-calendar-and-price.mjs`
`git commit -m "feat(deploy): configure calendar interval and verify healthy session reports"`

---

### Task 6: Create and Seed the First Live Liquidity Pool

**Files:**
- Script: `scripts/deploy/create-testnet-pool.mjs`
- Evidence: `evidence/deploy/testnet-pool-created.json`

**Interfaces:**
- Consumes: `BellPoolFactory.createAndSeed`, `WETH.deposit`, `AaplRehearsalStockToken.mint`, `Permit2.approve`.
- Produces: Initialized Uniswap v4 pool, deployed `BellHook` instance, and minted LP position on `PositionManager`.

- [ ] **Step 1: Write pool creation script**
Implement `scripts/deploy/create-testnet-pool.mjs`:
- Wrap testnet ETH into WETH.
- Approve tokens to Permit2 and PositionManager.
- Format `CreateRequest` for `SESSION_ONLY` pool with WETH and StockToken.
- Mine salt for CREATE2 address matching `EXPECTED_HOOK_MASK` (0x2cc0).
- Call `poolFactory.createAndSeed(request)`.
- Verify receipt: hook address, pool ID, position ID.
- Read `hook.getPolicy()`: assert `canSwap == true` and `mode == ACTIVE`!

- [ ] **Step 2: Execute pool creation on testnet**
Run: `node scripts/deploy/create-testnet-pool.mjs`
Expected: Transaction succeeds, pool and hook live, `canSwap == true`.

- [ ] **Step 3: Save evidence and commit**
`git add scripts/deploy/create-testnet-pool.mjs evidence/deploy/testnet-pool-created.json`
`git commit -m "feat(deploy): create and seed the first live SESSION_ONLY pool on testnet"`

---

### Task 7: Execute First Live Swap onchain

**Files:**
- Script: `scripts/deploy/execute-testnet-swap.mjs`
- Evidence: `evidence/deploy/testnet-swap-executed.json`

**Interfaces:**
- Consumes: `BellRouter.swap` (or direct PoolManager swap).
- Produces: Confirmed onchain swap transaction receipt with dynamic fee override and budget update.

- [ ] **Step 1: Write swap execution script**
Implement `scripts/deploy/execute-testnet-swap.mjs`:
- Approve token input to `BellRouter`.
- Submit `router.swap(key, params)` for an exact-input swap (e.g. 0.001 WETH -> StockToken).
- Wait for receipt, assert status == 'success'.
- Read updated `hook.buckets()` and `hook.getPolicy().rollingRemaining`: assert gross budget was consumed!

- [ ] **Step 2: Execute swap on testnet**
Run: `node scripts/deploy/execute-testnet-swap.mjs`
Expected: Swap succeeds, balances updated, gross budget tracked onchain.

- [ ] **Step 3: Save evidence and commit**
`git add scripts/deploy/execute-testnet-swap.mjs evidence/deploy/testnet-swap-executed.json`
`git commit -m "feat(deploy): execute first live onchain swap with dynamic session fee and budget commit"`

---

### Task 8: Update Documentation, Ledger & Final Verification

**Files:**
- Modify: `docs/CURRENT-STATE.md`
- Modify: `README.md`
- Modify: `evidence/task-status.json`

**Interfaces:**
- Consumes: Deployment and swap transaction hashes from Tasks 2-7.
- Produces: Updated `docs/CURRENT-STATE.md`, synchronized ledger `evidence/task-status.json`, passing `pnpm check`.

- [ ] **Step 1: Update CURRENT-STATE and README**
Record new contract addresses, pool ID, hook address, first live swap transaction hash, and current block number.

- [ ] **Step 2: Run full verification suite**
Run: `pnpm check`
Expected: 351 forge tests pass, 297 node tests pass, reference checks pass, all gates exit 0.

- [ ] **Step 3: Commit and push subtree to bell/main**
Run: `git commit -m "docs: document live testnet pool creation and first confirmed onchain swap"`
Run subtree split and push to `bell/main`.
