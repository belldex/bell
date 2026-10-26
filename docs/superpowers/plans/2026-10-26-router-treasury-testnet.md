# Router, Treasury Factory Integration, and Testnet Deployment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `BellRouter.sol` (M06-04), wire the restricted Treasury path into `BellPoolFactory.sol`, and build the Robinhood Testnet deployment tooling & rehearsal script (M06-05) targeting Chain 46630.

**Architecture:**
- `BellRouter.sol` provides zero-custody, single-transaction direct swap execution against pinned Uniswap v4 `PoolManager` with `caller = payer`, monotonic uint64 nonces, exact-in/exact-out settlement, and canonical WETH wrapping/unwrapping.
- `BellPoolFactory.sol` supports atomic `createAndSeed` for both `PUBLIC` (via `PositionManager`) and `TREASURY_ONLY` (via `TreasuryAdapter.seed(...)`), enforcing strict principal verification, invariant bounds, and fail-closed rollback.
- `scripts/deploy/deploy-testnet.mjs` orchestrates clean testnet deployment: verifies chain ID 46630, mines CREATE2 salts using `mineHookSalt`, deploys core protocol components, outputs a verified deploy manifest, and safeguards all credentials.

**Tech Stack:** Solidity 0.8.26, Foundry, Uniswap v4-core, OpenZeppelin ERC20/SafeERC20, Node.js 24, viem 2.57.11.

## Global Constraints

- Robinhood Testnet Chain ID is 46630; Mainnet Chain ID is 4663.
- Contract compiler is Solidity 0.8.26; EVM version Cancun; optimizer runs 200; bytecode_hash none.
- No secrets or private keys in Git or public logs; deployer private key read only from local `.env` (`RH_TESTNET_DEPLOYER_PRIVATE_KEY`).
- Swap and Create execution must be atomic, request-bound, and strictly fail-closed.
- Zero custody of foreign funds; no generic sweep or unauthorized token withdrawals.
- Full check (`pnpm check`) must pass at every milestone.

---

### Task 1: Implement `BellRouter.sol` (M06-04)

**Files:**
- Create: `contracts/src/BellRouter.sol`
- Modify: `contracts/src/types/ProtocolTypes.sol` (if helper selectors/errors needed)
- Test: `contracts/test/integration/router/BellRouter.t.sol`

**Interfaces:**
- Consumes:
  - `IPoolManager` from `@uniswap/v4-core/src/interfaces/IPoolManager.sol`
  - `PoolKey` from `@uniswap/v4-core/src/types/PoolKey.sol`
  - `BalanceDelta` from `@uniswap/v4-core/src/types/BalanceDelta.sol`
  - `Currency` from `@uniswap/v4-core/src/types/Currency.sol`
  - `SwapRequest` from `contracts/src/types/ProtocolTypes.sol`
  - `IWETH` / `IERC20` from `@openzeppelin/contracts/token/ERC20/IERC20.sol`
- Produces:
  - `function swap(SwapRequest calldata request) external payable returns (uint128 amountIn, uint128 amountOut)`
  - `function nonces(address payer) external view returns (uint64)`

- [ ] **Step 1: Write integration tests for BellRouter in `contracts/test/integration/router/BellRouter.t.sol`**
  Cover:
  - Exact-in swap: `amountSpecified` in, minimum `limitAmount` out.
  - Exact-out swap: maximum `limitAmount` in, `amountSpecified` out.
  - Slippage exceeded: reverts `SlippageExceeded()`.
  - Nonce invalid: reverts `InvalidNonce()`.
  - Expired deadline: reverts `DeadlineExpired()`.
  - Config hash mismatch: reverts `ConfigMismatch()`.
  - Zero-address recipient: reverts `InvalidRecipient()`.
  - Native ETH wrap and unwrap flows.
  - Zero dust remaining in router.

- [ ] **Step 2: Run test to verify it fails (router not implemented)**
  Run: `pnpm exec forge test --root contracts --match-contract BellRouterTest`
  Expected: FAIL with compilation error (contract does not exist).

- [ ] **Step 3: Implement `contracts/src/BellRouter.sol`**
  Implement:
  - `IPoolManager public immutable poolManager;`
  - `address public immutable canonicalWeth;`
  - `mapping(address => uint64) public nonces;`
  - `swap(SwapRequest calldata request) external payable returns (uint128 amountIn, uint128 amountOut)`
  - `unlockCallback(bytes calldata data) external returns (bytes memory)`
  - Safe token transfer / pull / take and WETH deposit/withdraw.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm exec forge test --root contracts --match-contract BellRouterTest -vv`
  Expected: All router integration tests PASS.

- [ ] **Step 5: Commit router implementation**
  ```bash
  git add contracts/src/BellRouter.sol contracts/test/integration/router/BellRouter.t.sol
  git commit -m "feat(m06-04): implement BellRouter direct swap settlement with WETH wrap/unwrap and slippage guards"
  ```

---

### Task 2: Integrate TreasuryAdapter Atomic Seed into `BellPoolFactory.sol`

**Files:**
- Modify: `contracts/src/BellPoolFactory.sol`
- Modify: `contracts/test/integration/factory/BellPoolFactory.t.sol`
- Test: `contracts/test/integration/factory/BellPoolFactory.t.sol`

**Interfaces:**
- Consumes:
  - `TreasuryAdapter` from `contracts/src/TreasuryAdapter.sol`
  - `LiquidityMode.TREASURY_ONLY`
- Produces:
  - `createAndSeed` supporting `profile.liquidityMode == LiquidityMode.TREASURY_ONLY` via `TreasuryAdapter.seed(...)`
  - Verification of `BellHook(hook).seedCaptured()` and principal accounting
  - Rollback on failure.

- [ ] **Step 1: Write failing test in `BellPoolFactory.t.sol` for TREASURY_ONLY atomic creation**
  Add `testFactoryCanCreateAndSeedTreasuryOnlyPool()` and `testFactoryTreasuryRollbackOnBadSeed()`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm exec forge test --root contracts --match-test testFactoryCanCreateAndSeedTreasuryOnlyPool`
  Expected: FAIL with `UnsupportedLiquidityMode()` or configuration revert.

- [ ] **Step 3: Update `contracts/src/BellPoolFactory.sol`**
  - Accept `profile.liquidityMode == LiquidityMode.TREASURY_ONLY` when `profile.treasuryAdapter != address(0)`.
  - In `createAndSeed`, if mode is `TREASURY_ONLY`, call `TreasuryAdapter(r.config.treasuryAdapter).seed(requestHash, r)`, verify principal against `BellHook.seedPrincipal()`, and activate pool with `tokenId = 0`.
  - Keep strict refund and service fee mechanics.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm exec forge test --root contracts --match-contract BellPoolFactoryTest -vv`
  Expected: All factory tests PASS.

- [ ] **Step 5: Commit factory treasury integration**
  ```bash
  git add contracts/src/BellPoolFactory.sol contracts/test/integration/factory/BellPoolFactory.t.sol
  git commit -m "feat(m06-01): support atomic TREASURY_ONLY pool creation and seeding in BellPoolFactory"
  ```

---

### Task 3: Build Testnet Deploy Tooling & Manifest Generator (M06-05)

**Files:**
- Create: `scripts/deploy/deploy-testnet.mjs`
- Create: `scripts/deploy/deploy-manifest.mjs`
- Test: `scripts/deploy/deploy-manifest.test.mjs`
- Modify: `package.json` (add `"deploy:testnet:dry-run"` script)

**Interfaces:**
- Consumes:
  - `RH_TESTNET_RPC_PRIMARY` from `.env`
  - `RH_TESTNET_DEPLOYER_PRIVATE_KEY` (optional for dry-run/preview)
  - Compiled contract artifacts from `contracts/out/`
  - `mineHookSalt` from `scripts/tooling/mine-hook-salt.mjs`
- Produces:
  - Validated testnet deployment preview & execution bundle
  - JSON deployment manifest saved to `evidence/runtime/testnet-deploy-manifest.json`
  - Predicted CREATE2 addresses and hook salt matching Chain ID 46630.

- [ ] **Step 1: Write tests for deploy manifest generator in `scripts/deploy/deploy-manifest.test.mjs`**
  Verify manifest structure, parameter normalization, hash checks, and rejection of placeholder or zero addresses.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test scripts/deploy/deploy-manifest.test.mjs`
  Expected: FAIL with module not found.

- [ ] **Step 3: Implement `scripts/deploy/deploy-manifest.mjs` and `scripts/deploy/deploy-testnet.mjs`**
  - Chain ID validation (must match 46630 for testnet).
  - Accurate constructor parameter packing for `SessionRegistry`, `AssetRegistry`, `CalendarRegistry`, `SafetyController`, `BellHookDeployer`, `BellPoolFactory`, `TreasuryAdapter`, and `BellRouter`.
  - CREATE2 address prediction and salt mining.
  - `--dry-run` mode that outputs full deployment plan without broadcasting.
  - Live broadcast mode when `RH_TESTNET_DEPLOYER_PRIVATE_KEY` is present.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test scripts/deploy/deploy-manifest.test.mjs`
  Expected: PASS.
  Run dry-run: `node scripts/deploy/deploy-testnet.mjs --dry-run`
  Expected: Valid dry-run preview and manifest generated.

- [ ] **Step 5: Commit deploy tooling**
  ```bash
  git add scripts/deploy/ package.json
  git commit -m "feat(m06-05): add Robinhood testnet deployment script and manifest tooling"
  ```

---

### Task 4: Full Suite Verification & Task Status Alignment

**Files:**
- Modify: `evidence/task-status.json`
- Modify: `evidence/releases/index.json`
- Test: `pnpm check`

**Interfaces:**
- Validates:
  - 325+ Foundry tests
  - 243+ Node tests
  - Reference Python checks
  - Deno portable tests
  - Cloudflare worker tests and dry-run build
  - Secret boundary check (no credentials committed)
  - Release evidence verification

- [ ] **Step 1: Run complete workspace verification**
  Run: `pnpm check`
  Expected: 100% green on all test suites and boundary checks.

- [ ] **Step 2: Update `task-status.json` to record M06-04 progress and M06-05 manifest tooling**
  Ensure implementationPlanSha256 matches and no blockers exist on any task marked DONE.

- [ ] **Step 3: Verify evidence checker**
  Run: `pnpm evidence:check`
  Expected: PASS.

- [ ] **Step 4: Commit task status updates**
  ```bash
  git add evidence/task-status.json evidence/releases/index.json
  git commit -m "chore(evidence): update task ledger for router and testnet deployment tooling"
  ```
