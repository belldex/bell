# BellOpeningAuction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `BellOpeningAuction`, the per-pool escrow that batches the opening-bell order flow, clears it at one uniform price, nets what it can peer-to-peer, and sends only the residual to the pool.

**Architecture:** A standalone contract per pool. It escrows orders behind Permit2, gates regular swaps through a `blocksSwaps()` view the hook reads, and writes per-order fill allocations at settle time that owners claim individually afterwards. The residual swap goes through a small adapter interface so this contract can be tested without a hook, a PoolManager, or a router.

**Tech Stack:** Solidity 0.8.26 (Cancun, viaIR), Foundry (`forge`), Uniswap v4 core math (`FullMath`, `SqrtPriceMath`, `TickMath`) already vendored under `contracts/lib/v4-core`.

**Spec:** `devbrief1bell.md` (final, committed).

## Global Constraints

- Solidity `0.8.26`, `pragma solidity 0.8.26;`, SPDX `MIT` on every file.
- Custom errors, never string reverts.
- NatSpec on every external/public function, in the terse declarative style used by `contracts/src/BellRouter.sol`.
- No upgradeable proxies. No `selfdestruct`. No assembly except through vendored `FullMath`/v4 math.
- Reverts must be fail-closed: an unset or malformed input blocks the action rather than defaulting to permissive.
- `cancel` and `claimRefund` must never consult `SafetyController`, and must never be reachable only through a pausable path.
- LP exit stays unblockable: nothing in this plan touches `beforeRemoveLiquidity` / `afterRemoveLiquidity`.
- Every new error and branch added to the loss-of-funds surface gets an entry in `contracts/test/LossOfFundsIndex.t.sol`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `contracts/src/auction/BellOpeningAuction.sol` | The auction: escrow, lifecycle, settle, claims, refunds |
| `contracts/src/auction/IAuctionResidualAdapter.sol` | The one seam between the auction and the pool |
| `contracts/src/libraries/AuctionClearing.sol` | Pure clearing math: netting, residual size, price conversion |
| `contracts/test/BellOpeningAuction.t.sol` | Behavioural tests against a mock adapter |
| `contracts/test/AuctionClearing.t.sol` | Pure math tests |
| `contracts/test/harness/AuctionClearingHarness.sol` | Library harness exposing internal pure functions |
| `contracts/test/harness/MockAuctionAdapter.sol` | Deterministic executor used by the behavioural tests |

`BellOpeningAuction` deliberately has **one** external dependency (`IAuctionResidualAdapter`). It does not import the hook, the factory, the router, or the PoolManager. That is what makes it testable on its own and what keeps Plan B free to wire it to real v4.

---

## Interfaces

Produced by this plan and consumed by Plan B (hook + factory) and Plan C (frontend + keeper).

```solidity
interface IAuctionResidualAdapter {
    /// @notice Pool price at the moment the residual is quoted.
    function poolSqrtPriceX96() external view returns (uint160);
    /// @notice Execute one exact-input residual swap. Pulls `amountIn` of the input token
    ///         from the caller (msg.sender) and returns the realised output amount.
    function swapExactInput(bool zeroForOne, uint128 amountIn, uint128 minAmountOut, uint256 deadline)
        external
        returns (uint128 amountOut);
}

interface IBellOpeningAuction {
    function stage() external view returns (uint8);
    function blocksSwaps() external view returns (bool);
    function orderCount() external view returns (uint32);
    function submitOrder(bool zeroForOne, uint128 amountIn, uint160 limitSqrtPriceX96) external;
    function cancelOrder(uint32 id) external;
    function lock() external;
    function settle(uint160 clearingSqrtPriceX96) external;
    function claimSell(uint32 id) external;
    function claimBuy(uint32 id) external;
    function claimRefund(uint32 id) external;
    function claimRefundAll(uint32[] calldata ids) external;
}
```

Stage encoding: `0 = IDLE`, `1 = OPEN`, `2 = LOCKED`, `3 = SETTLED`, `4 = REFUNDED`.

---

### Task 1: Scaffold the auction and escrow orders

**Files:**
- Create: `contracts/src/auction/IAuctionResidualAdapter.sol`
- Create: `contracts/src/auction/BellOpeningAuction.sol`
- Create: `contracts/test/harness/MockAuctionAdapter.sol`
- Test: `contracts/test/BellOpeningAuction.t.sol`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `BellOpeningAuction` constructor `(address hook, address adapter, address token0, address token1, uint64 openTime, uint32 auctionLead, uint32 settleTimeout, uint128[2] minOrderSize, uint128 residualCap, uint8 maxOrders)`; `submitOrder(bool,uint128,uint160)`; `cancelOrder(uint32)`; `stage()`; `orderCount()`; error `AuctionNotOpen()`, `OrderTooSmall()`, `BookFull()`, `NotOrderOwner()`, `OrderAlreadyGone()`.

- [ ] **Step 1: Write the adapter interface**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IAuctionResidualAdapter
/// @notice The only seam between the auction and the pool.
/// @dev Implemented in production by a thin adapter over BellRouter; in tests by MockAuctionAdapter.
///      Keeping it this narrow is what lets the auction be tested without v4.
interface IAuctionResidualAdapter {
    /// @notice Pool price at the moment the residual is quoted.
    function poolSqrtPriceX96() external view returns (uint160);

    /// @notice Execute one exact-input residual swap.
    /// @dev Pulls `amountIn` of the input token from the caller (`msg.sender`) and returns the
    ///      realised output amount. `zeroForOne` follows the v4 pool convention.
    function swapExactInput(bool zeroForOne, uint128 amountIn, uint128 minAmountOut, uint256 deadline)
        external
        returns (uint128 amountOut);
}
```

- [ ] **Step 2: Write the failing escrow tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BellOpeningAuction} from "../src/auction/BellOpeningAuction.sol";
import {MockAuctionAdapter} from "./harness/MockAuctionAdapter.sol";

contract MockToken is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract BellOpeningAuctionEscrowTest is Test {
    BellOpeningAuction auction;
    MockAuctionAdapter adapter;
    MockToken token0;
    MockToken token1;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint64 constant OPEN_TIME = 1_800_000_000;

    function setUp() public {
        token0 = new MockToken("Quote", "USDG");
        token1 = new MockToken("Base", "AAPL");
        adapter = new MockAuctionAdapter();
        auction = new BellOpeningAuction(
            address(0xF00D),          // hook
            address(adapter),
            address(token0),
            address(token1),
            OPEN_TIME,
            600,                      // auctionLead
            900,                      // settleTimeout
            [uint128(1e6), uint128(1e18)],
            10e18,                    // residualCap
            25                        // maxOrders
        );
        vm.warp(OPEN_TIME - 600);     // auction window open
        token0.mint(alice, 1_000e6);
        token1.mint(bob, 1_000e18);
    }

    function test_submitOrder_escrowsInput() public {
        vm.prank(alice);
        token0.approve(address(auction), type(uint256).max);
        vm.prank(alice);
        auction.submitOrder(true, 100e6, 0);

        assertEq(auction.orderCount(), 1);
        assertEq(token0.balanceOf(alice), 900e6);
        assertEq(token0.balanceOf(address(auction)), 100e6);
    }

    function test_submitOrder_revertsBelowMinSize() public {
        vm.prank(alice);
        token0.approve(address(auction), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(BellOpeningAuction.OrderTooSmall.selector);
        auction.submitOrder(true, 1, 0);
    }

    function test_cancelOrder_returnsEscrow() public {
        vm.prank(bob);
        token1.approve(address(auction), type(uint256).max);
        vm.prank(bob);
        auction.submitOrder(false, 5e18, 0);

        vm.prank(bob);
        auction.cancelOrder(0);

        assertEq(token1.balanceOf(bob), 1_000e18);
        assertEq(token1.balanceOf(address(auction)), 0);
    }

    function test_cancelOrder_revertsForNonOwner() public {
        vm.prank(bob);
        token1.approve(address(auction), type(uint256).max);
        vm.prank(bob);
        auction.submitOrder(false, 5e18, 0);

        vm.prank(alice);
        vm.expectRevert(BellOpeningAuction.NotOrderOwner.selector);
        auction.cancelOrder(0);
    }
}
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `forge test --root contracts --match-contract BellOpeningAuctionEscrowTest -vv`
Expected: FAIL — compilation error, `BellOpeningAuction` not found.

- [ ] **Step 4: Write the mock adapter**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAuctionResidualAdapter} from "../../src/auction/IAuctionResidualAdapter.sol";

/// @dev Deterministic executor for tests. Swaps at a fixed 1:1e12 ratio so amounts stay readable.
contract MockAuctionAdapter is IAuctionResidualAdapter {
    uint160 public priceX96 = 1 << 96;
    uint128 public lastAmountIn;
    bool public lastZeroForOne;
    bool public revertNext;

    function setPrice(uint160 p) external { priceX96 = p; }
    function setRevertNext(bool v) external { revertNext = v; }
    function poolSqrtPriceX96() external view returns (uint160) { return priceX96; }

    function swapExactInput(bool zeroForOne, uint128 amountIn, uint128 minAmountOut, uint256)
        external
        returns (uint128 amountOut)
    {
        if (revertNext) revert("adapter");
        lastAmountIn = amountIn;
        lastZeroForOne = zeroForOne;
        amountOut = zeroForOne ? amountIn / 1e12 : amountIn * 1e12;
        require(amountOut >= minAmountOut, "slippage");
    }
}
```

- [ ] **Step 5: Write the minimal auction: storage, constructor, escrow, cancel**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAuctionResidualAdapter} from "./IAuctionResidualAdapter.sol";

/// @title BellOpeningAuction
/// @notice One per pool. Escrows the opening-bell order flow, clears it at a single price, and
///         sends only the unmatched residual to the pool.
/// @dev Holds user funds for the length of the window, so every exit path is permissionless and
///      independent of any pausable controller. See devbrief1bell.md sections 4, 6 and 7.
contract BellOpeningAuction {
    using SafeERC20 for IERC20;

    enum Stage { IDLE, OPEN, LOCKED, SETTLED, REFUNDED }

    struct Order {
        address owner;
        bool zeroForOne;
        uint128 amountIn;
        uint160 limitSqrtPriceX96;
        bool gone;
    }

    error AuctionNotOpen();
    error OrderTooSmall();
    error BookFull();
    error NotOrderOwner();
    error OrderAlreadyGone();
    error EscrowEmpty();

    address public immutable hook;
    address public immutable adapter;
    address public immutable token0;
    address public immutable token1;
    uint64 public immutable openTime;
    uint32 public immutable auctionLead;
    uint32 public immutable settleTimeout;
    uint128 public immutable minOrderSize0;
    uint128 public immutable minOrderSize1;
    uint128 public immutable residualCap;
    uint8 public immutable maxOrders;

    Order[] internal _orders;

    constructor(
        address hook_,
        address adapter_,
        address token0_,
        address token1_,
        uint64 openTime_,
        uint32 auctionLead_,
        uint32 settleTimeout_,
        uint128[2] memory minOrderSize_,
        uint128 residualCap_,
        uint8 maxOrders_
    ) {
        hook = hook_;
        adapter = adapter_;
        token0 = token0_;
        token1 = token1_;
        openTime = openTime_;
        auctionLead = auctionLead_;
        settleTimeout = settleTimeout_;
        minOrderSize0 = minOrderSize_[0];
        minOrderSize1 = minOrderSize_[1];
        residualCap = residualCap_;
        maxOrders = maxOrders_;
    }

    /// @notice Current lifecycle stage.
    function stage() public view returns (uint8) {
        if (block.timestamp < openTime - auctionLead) return uint8(Stage.IDLE);
        if (block.timestamp < openTime) return uint8(Stage.OPEN);
        return uint8(Stage.LOCKED);
    }

    /// @notice Number of orders ever submitted, including cancelled ones.
    function orderCount() external view returns (uint32) {
        return uint32(_orders.length);
    }

    /// @notice Order record by id.
    function order(uint32 id) external view returns (Order memory) {
        return _orders[id];
    }

    /// @notice Escrow one order. The input token is pulled immediately.
    /// @dev `zeroForOne` follows the v4 pool convention: true sells token0 for token1.
    function submitOrder(bool zeroForOne, uint128 amountIn, uint160 limitSqrtPriceX96) external {
        if (stage() != uint8(Stage.OPEN)) revert AuctionNotOpen();
        if (amountIn < (zeroForOne ? minOrderSize0 : minOrderSize1)) revert OrderTooSmall();
        if (_orders.length >= maxOrders) revert BookFull();

        address inToken = zeroForOne ? token0 : token1;
        IERC20(inToken).safeTransferFrom(msg.sender, address(this), amountIn);

        _orders.push(
            Order({
                owner: msg.sender,
                zeroForOne: zeroForOne,
                amountIn: amountIn,
                limitSqrtPriceX96: limitSqrtPriceX96,
                gone: false
            })
        );
    }

    /// @notice Withdraw an order any time before the cutoff.
    function cancelOrder(uint32 id) external {
        if (block.timestamp >= openTime) revert AuctionNotOpen();
        Order storage o = _orders[id];
        if (o.owner != msg.sender) revert NotOrderOwner();
        if (o.gone) revert OrderAlreadyGone();
        o.gone = true;
        IERC20(o.zeroForOne ? token0 : token1).safeTransfer(o.owner, o.amountIn);
    }
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `forge test --root contracts --match-contract BellOpeningAuctionEscrowTest -vv`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add contracts/src/auction contracts/test/BellOpeningAuction.t.sol contracts/test/harness/MockAuctionAdapter.sol
git commit -m "feat(auction): escrow opening-bell orders behind a single adapter seam"
```

---

### Task 2: Swap gating and the lock transition

**Files:**
- Modify: `contracts/src/auction/BellOpeningAuction.sol`
- Test: `contracts/test/BellOpeningAuction.t.sol`

**Interfaces:**
- Consumes: Task 1's `stage()`, `_orders`.
- Produces: `blocksSwaps()` (read by the hook in Plan B), `lock()`, error `NothingToSettle()`.

- [ ] **Step 1: Write the failing gating tests**

```solidity
    function test_blocksSwaps_trueWhileOpenOrLocked() public {
        assertTrue(auction.blocksSwaps());
        vm.warp(OPEN_TIME);
        assertTrue(auction.blocksSwaps());
        vm.warp(OPEN_TIME + 900 + 1);
        assertFalse(auction.blocksSwaps()); // timeout reached: refunds, swaps reopen
    }

    function test_blocksSwaps_falseBeforeWindow() public {
        vm.warp(OPEN_TIME - 601);
        assertFalse(auction.blocksSwaps());
    }

    function test_lock_requiresCutoff() public {
        vm.expectRevert(BellOpeningAuction.AuctionNotOpen.selector);
        auction.lock();
        vm.warp(OPEN_TIME);
        auction.lock();
        assertEq(auction.stage(), uint8(2)); // LOCKED
    }

    function test_submitOrder_revertsAfterCutoff() public {
        vm.warp(OPEN_TIME);
        vm.prank(alice);
        token0.approve(address(auction), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(BellOpeningAuction.AuctionNotOpen.selector);
        auction.submitOrder(true, 100e6, 0);
    }

    function test_cancelOrder_revertsAfterCutoff() public {
        vm.prank(bob);
        token1.approve(address(auction), type(uint256).max);
        vm.prank(bob);
        auction.submitOrder(false, 5e18, 0);
        vm.warp(OPEN_TIME);
        vm.prank(bob);
        vm.expectRevert(BellOpeningAuction.AuctionNotOpen.selector);
        auction.cancelOrder(0);
    }
```

- [ ] **Step 2: Run and confirm they fail**

Run: `forge test --root contracts --match-contract BellOpeningAuctionEscrowTest -vv`
Expected: FAIL — `blocksSwaps` and `lock` not found.

- [ ] **Step 3: Implement gating and lock**

Add to `BellOpeningAuction`:

```solidity
    /// @dev Set once lock() runs so a settled-then-refunded auction cannot be reopened.
    bool internal _locked;
    /// @dev Settlement outcome; zero until settle() succeeds.
    bool internal _settled;

    /// @notice True while the hook must reject ordinary swaps so the batch can clear first.
    /// @dev Must go false on the refund timeout, otherwise a failed settle bricks the pool.
    function blocksSwaps() public view returns (bool) {
        if (_settled) return false;
        if (_refunded) return false;
        if (block.timestamp >= openTime + settleTimeout) return false;
        if (block.timestamp < openTime - auctionLead) return false;
        return true;
    }

    /// @notice Close the book so orders can neither enter nor leave.
    function lock() external {
        if (block.timestamp < openTime) revert AuctionNotOpen();
        _locked = true;
    }
```

Add the matching storage flag next to `_settled`:

```solidity
    bool internal _refunded;
```

Extend `stage()` so `LOCKED` is reported for the whole post-cutoff window:

```solidity
    function stage() public view returns (uint8) {
        if (_settled) return uint8(Stage.SETTLED);
        if (_refunded) return uint8(Stage.REFUNDED);
        if (block.timestamp < openTime - auctionLead) return uint8(Stage.IDLE);
        if (block.timestamp < openTime) return uint8(Stage.OPEN);
        return uint8(Stage.LOCKED);
    }
```

And make `cancelOrder` also refuse once locked:

```solidity
        if (block.timestamp >= openTime) revert AuctionNotOpen();
```

(unchanged — the cutoff check already covers it; the test pins the behaviour.)

- [ ] **Step 4: Run and confirm they pass**

Run: `forge test --root contracts --match-contract BellOpeningAuctionEscrowTest -vv`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/auction/BellOpeningAuction.sol contracts/test/BellOpeningAuction.t.sol
git commit -m "feat(auction): gate swaps through the window and reopen them on the refund timeout"
```

---

### Task 3: Clearing math

**Files:**
- Create: `contracts/src/libraries/AuctionClearing.sol`
- Create: `contracts/test/harness/AuctionClearingHarness.sol`
- Test: `contracts/test/AuctionClearing.t.sol`

**Interfaces:**
- Consumes: nothing.
- Produces: `AuctionClearing.baseForQuote(uint256 quoteAmount, uint160 sqrtPriceX96, bool quoteIsToken0) returns (uint256)`; `AuctionClearing.quoteForBase(uint256 baseAmount, uint160 sqrtPriceX96, bool quoteIsToken0) returns (uint256)`; `AuctionClearing.sellLimitOk(bool zeroForOne, uint160 limitSqrtPriceX96, uint160 clearingSqrtPriceX96) returns (bool)`.

**Why this exists:** the netting identity is the whole feature. Buyers receive exactly the base they asked for and sellers receive exactly `base_in * P*`, because the pool absorbs `B - S` and the arithmetic cancels. That identity is pure math and must be proven before any escrow code relies on it.

- [ ] **Step 1: Write the failing math tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AuctionClearingHarness} from "./harness/AuctionClearingHarness.sol";

contract AuctionClearingTest is Test {
    AuctionClearingHarness h;

    function setUp() public { h = new AuctionClearingHarness(); }

    /// @dev sqrtPrice 2^96 means a raw 1:1 pool.
    function test_quoteForBase_unitPrice_isIdentity() public view {
        assertEq(h.quoteForBase(1_000, 1 << 96, true), 1_000);
    }

    /// @dev price 4 (raw) => sqrtPrice 2*2^96 => 1 base buys 4 quote.
    function test_quoteForBase_doublePrice() public view {
        assertEq(h.quoteForBase(1_000, 2 * (1 << 96), true), 4_000);
    }

    function test_baseForQuote_invertsQuoteForBase() public view {
        uint256 q = h.quoteForBase(1_000, 2 * (1 << 96), true);
        assertApproxEqAbs(h.baseForQuote(q, 2 * (1 << 96), true), 1_000, 1);
    }

    /// @dev When quote is token0 the ratio inverts.
    function test_quoteForBase_invertedWhenQuoteIsToken0() public view {
        assertEq(h.quoteForBase(4_000, 2 * (1 << 96), false), 1_000);
    }

    function test_sellLimit_sellerNeedsPriceAtOrAboveLimit() public view {
        assertTrue(h.sellLimitOk(true, 1 << 96, (1 << 96) + 1));
        assertFalse(h.sellLimitOk(true, 1 << 96, (1 << 96) - 1));
        assertTrue(h.sellLimitOk(true, 0, 1));         // zero limit means no bound
    }

    function test_sellLimit_buyerNeedsPriceAtOrBelowLimit() public view {
        assertTrue(h.sellLimitOk(false, 1 << 96, (1 << 96) - 1));
        assertFalse(h.sellLimitOk(false, 1 << 96, (1 << 96) + 1));
        assertTrue(h.sellLimitOk(false, 0, type(uint160).max));
    }
}
```

- [ ] **Step 2: Run and confirm they fail**

Run: `forge test --root contracts --match-contract AuctionClearingTest -vv`
Expected: FAIL — compilation error, harness not found.

- [ ] **Step 3: Write the harness and the library**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionClearing} from "../../src/libraries/AuctionClearing.sol";

contract AuctionClearingHarness {
    function quoteForBase(uint256 baseAmount, uint160 sqrtPriceX96, bool quoteIsToken1)
        external pure returns (uint256)
    {
        return AuctionClearing.quoteForBase(baseAmount, sqrtPriceX96, quoteIsToken1);
    }

    function baseForQuote(uint256 quoteAmount, uint160 sqrtPriceX96, bool quoteIsToken1)
        external pure returns (uint256)
    {
        return AuctionClearing.baseForQuote(quoteAmount, sqrtPriceX96, quoteIsToken1);
    }

    function sellLimitOk(bool zeroForOne, uint160 limitSqrtPriceX96, uint160 clearingSqrtPriceX96)
        external pure returns (bool)
    {
        return AuctionClearing.sellLimitOk(zeroForOne, limitSqrtPriceX96, clearingSqrtPriceX96);
    }
}
```

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";

/// @title AuctionClearing
/// @notice Pure clearing math for the opening-bell batch.
/// @dev Prices are v4 `sqrtPriceX96` values, so no decimal scaling is needed: the pool's own
///      units already encode the token decimals. `quoteIsToken1` selects the orientation.
library AuctionClearing {
    uint256 internal constant Q96 = 1 << 96;

    /// @notice Quote value of a base amount at a given pool price.
    /// @param baseAmount Amount of the base (stock) token, in that token's raw units.
    /// @param sqrtPriceX96 Resolving pool price.
    /// @param quoteIsToken1 True when the quote token is the pool's token1.
    function quoteForBase(uint256 baseAmount, uint160 sqrtPriceX96, bool quoteIsToken1)
        internal
        pure
        returns (uint256)
    {
        // token1Raw per token0Raw = (sqrtPriceX96 / 2^96)^2
        uint256 sq = uint256(sqrtPriceX96);
        uint256 numerator = baseAmount * sq;      // <= 2^128 * 2^160, fits in 2^288 -> use mulDiv
        uint256 ratio = FullMath.mulDiv(numerator, sq, Q96 * Q96);
        return quoteIsToken1 ? ratio : (ratio == 0 ? 0 : FullMath.mulDiv(baseAmount, Q96 * Q96, numerator));
    }

    /// @notice Base amount obtained for a quote amount at a given pool price.
    function baseForQuote(uint256 quoteAmount, uint160 sqrtPriceX96, bool quoteIsToken1)
        internal
        pure
        returns (uint256)
    {
        uint256 sq = uint256(sqrtPriceX96);
        uint256 denominator = quoteAmount * sq;
        if (denominator == 0) return 0;
        uint256 ratio = FullMath.mulDiv(denominator, sq, Q96 * Q96);
        return quoteIsToken1 ? (ratio == 0 ? 0 : FullMath.mulDiv(quoteAmount, Q96 * Q96, denominator)) : ratio;
    }

    /// @notice Whether an order still accepts the clearing price.
    /// @dev Sellers (`zeroForOne`) need price at or above their limit; buyers need at or below.
    ///      A zero limit means the owner set no bound.
    function sellLimitOk(bool zeroForOne, uint160 limitSqrtPriceX96, uint160 clearingSqrtPriceX96)
        internal
        pure
        returns (bool)
    {
        if (limitSqrtPriceX96 == 0) return true;
        return zeroForOne ? clearingSqrtPriceX96 >= limitSqrtPriceX96 : clearingSqrtPriceX96 <= limitSqrtPriceX96;
    }
}
```

> **Implementer note:** `quoteForBase` and `baseForQuote` are exact inverses only up to rounding. The tests assert `assertApproxEqAbs(..., 1)`. Keep both using `FullMath.mulDiv` so the rounding is deterministic and the identity stays within one unit.

- [ ] **Step 4: Run and confirm they pass**

Run: `forge test --root contracts --match-contract AuctionClearingTest -vv`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/libraries/AuctionClearing.sol contracts/test/AuctionClearing.t.sol contracts/test/harness/AuctionClearingHarness.sol
git commit -m "feat(auction): pure clearing math with the netting identity pinned by tests"
```

---

### Task 4: Settle the batch

**Files:**
- Modify: `contracts/src/auction/BellOpeningAuction.sol`
- Test: `contracts/test/BellOpeningAuction.t.sol`

**Interfaces:**
- Consumes: `IAuctionResidualAdapter.swapExactInput`, `AuctionClearing.*`, Task 2's `_locked`.
- Produces: `settle(uint160 clearingSqrtPriceX96)`, `clearingSqrtPriceX96()` view, `claimBase(uint32)` and `claimQuote(uint32)` amounts readable via `payouts(uint32)`, errors `NotLocked()`, `NothingToSettle()`, `LimitViolated()`, `ResidualTooLarge()`, `ClearingPriceMismatch()`, `AlreadySettled()`.

- [ ] **Step 1: Write the failing settle tests**

```solidity
    function _seedTwoSidedBook() internal {
        // Alice BUYS base: spends token0 (quote), zeroForOne = true.
        token0.mint(alice, 1_000e18);
        vm.prank(alice);
        token0.approve(address(auction), type(uint256).max);
        vm.prank(alice);
        auction.submitOrder(true, 100e18, 0);

        // Bob SELLS base: spends token1, zeroForOne = false.
        token1.mint(bob, 1_000e18);
        vm.prank(bob);
        token1.approve(address(auction), type(uint256).max);
        vm.prank(bob);
        auction.submitOrder(false, 100e18, 0);
    }

    /// @dev At raw price 1 (sqrtPrice = 2^96) 100e18 quote buys exactly 100e18 base, so the two
    ///      sides net and the pool must not be touched at all.
    function test_settle_directMatch_needsNoPoolSwap() public {
        _seedTwoSidedBook();
        vm.warp(OPEN_TIME);
        auction.lock();
        auction.settle(1 << 96);
        assertEq(adapter.lastAmountIn(), 0);
    }

    function test_settle_revertsBeforeLock() public {
        vm.warp(OPEN_TIME);
        vm.expectRevert(BellOpeningAuction.NotLocked.selector);
        auction.settle(1 << 96);
    }

    function test_settle_rejectsPriceOutsideLimit() public {
        token0.mint(alice, 1_000e18);
        vm.prank(alice);
        token0.approve(address(auction), type(uint256).max);
        vm.prank(alice);
        auction.submitOrder(true, 100e18, 2 * (1 << 96)); // buyer caps the price at 4
        vm.warp(OPEN_TIME);
        auction.lock();
        vm.expectRevert(BellOpeningAuction.LimitViolated.selector);
        auction.settle(2 * (1 << 96) + 1);
    }

    function test_settle_recordsBuyerAndSellerPayouts() public {
        _seedTwoSidedBook();
        vm.warp(OPEN_TIME);
        auction.lock();
        auction.settle(1 << 96);

        (uint128 baseOut0, uint128 quoteOut0,) = auction.payouts(0);
        assertEq(baseOut0, 100e18); // Alice is the buyer: she receives base
        assertEq(quoteOut0, 0);

        (uint128 baseOut1, uint128 quoteOut1,) = auction.payouts(1);
        assertEq(baseOut1, 0);
        assertEq(quoteOut1, 100e18); // Bob is the seller: he receives quote
    }
```

- [ ] **Step 2: Run and confirm they fail**

Run: `forge test --root contracts --match-contract BellOpeningAuctionEscrowTest -vv`
Expected: FAIL — `settle`, `payouts`, `NotLocked`, `LimitViolated` not found.

- [ ] **Step 3: Implement settle**

Add to `BellOpeningAuction`:

```solidity
    error NotLocked();
    error NothingToSettle();
    error LimitViolated();
    error ResidualTooLarge();
    error ClearingPriceMismatch();
    error AlreadySettled();

    /// @dev Per-order outcome written by settle(); claimed later and then zeroed.
    struct Payout {
        uint128 baseOut;
        uint128 quoteOut;
        bool claimable;
    }

    uint16 internal constant PRICE_TOLERANCE_BPS = 50; // 0.5%

    uint160 internal _clearingSqrtPriceX96;
    Payout[] internal _payouts;

    /// @notice The price the batch cleared at, once settled.
    function clearingSqrtPriceX96() external view returns (uint160) { return _clearingSqrtPriceX96; }

    /// @notice Per-order settlement outcome.
    function payouts(uint32 id) external view returns (uint128 baseOut, uint128 quoteOut, bool claimable) {
        Payout memory p = _payouts[id];
        return (p.baseOut, p.quoteOut, p.claimable);
    }

    /// @notice Clear the batch at one uniform price and route only the residual to the pool.
    /// @dev Permissionless: the caller only proposes a price and every constraint is re-checked here,
    ///      so a bad proposal reverts instead of moving funds. Token0 is the quote, token1 is the base.
    function settle(uint160 clearingSqrtPriceX96_) external {
        if (!_locked) revert NotLocked();
        if (_settled) revert AlreadySettled();
        if (_orders.length == 0) revert NothingToSettle();

        uint256 supplyBase; // base offered by sellers (zeroForOne == false)
        uint256 demandBase; // base wanted by buyers (zeroForOne == true), converted at P*

        for (uint256 i; i < _orders.length; ++i) {
            Order memory o = _orders[i];
            if (o.gone) continue;
            if (!AuctionClearing.sellLimitOk(o.zeroForOne, o.limitSqrtPriceX96, clearingSqrtPriceX96_)) {
                revert LimitViolated();
            }
            if (o.zeroForOne) {
                demandBase += AuctionClearing.baseForQuote(o.amountIn, clearingSqrtPriceX96_, false);
            } else {
                supplyBase += o.amountIn;
            }
        }

        uint256 residual;
        if (demandBase >= supplyBase) {
            residual = demandBase - supplyBase; // the pool must supply this much base
        } else {
            residual = supplyBase - demandBase; // the pool must absorb this much base
        }
        if (residual > residualCap) revert ResidualTooLarge();

        if (residual > 0) {
            uint256 deadline = block.timestamp + 300;
            if (demandBase >= supplyBase) {
                // Pay quote (token0) to receive base (token1): token0 in, token1 out.
                uint128 quoteIn = uint128(AuctionClearing.quoteForBase(residual, clearingSqrtPriceX96_, false));
                IAuctionResidualAdapter(adapter).swapExactInput(true, quoteIn, uint128(residual), deadline);
            } else {
                // Give base (token1) to receive quote (token0): token1 in, token0 out.
                IAuctionResidualAdapter(adapter).swapExactInput(false, uint128(residual), 0, deadline);
            }
            _requirePriceOk(clearingSqrtPriceX96_, IAuctionResidualAdapter(adapter).poolSqrtPriceX96());
        }
        _clearingSqrtPriceX96 = clearingSqrtPriceX96_;

        // The netting identity: buyers receive exactly the base they asked for, and sellers receive
        // exactly base_in * P*. The pool leg cancels the difference, so neither side takes a haircut.
        for (uint256 i; i < _orders.length; ++i) {
            Order memory o = _orders[i];
            if (o.gone) {
                _payouts.push(Payout(0, 0, false));
                continue;
            }
            if (o.zeroForOne) {
                uint128 baseOut = uint128(AuctionClearing.baseForQuote(o.amountIn, clearingSqrtPriceX96_, false));
                _payouts.push(Payout(baseOut, 0, true));
            } else {
                uint128 quoteOut = uint128(AuctionClearing.quoteForBase(o.amountIn, clearingSqrtPriceX96_, false));
                _payouts.push(Payout(0, quoteOut, true));
            }
        }
        _settled = true;
    }
```

> **Orientation convention, used everywhere in this contract:** `zeroForOne == true` spends token0 (the quote) to receive token1 (the base), so it is a **buyer**. `zeroForOne == false` spends token1 (the base), so it is a **seller**. Token0 is always the quote.

- [ ] **Step 4: Add the price check helper**

```solidity
    /// @dev The joint-solve condition, verified instead of searched: after the residual the pool's
    ///      own price must be the clearing price, within tolerance. Without this the batch could
    ///      leave free arbitrage behind.
    function _requirePriceOk(uint160 clearing, uint160 after) private view {
        uint256 lo = (uint256(clearing) * (10_000 - PRICE_TOLERANCE_BPS)) / 10_000;
        uint256 hi = (uint256(clearing) * (10_000 + PRICE_TOLERANCE_BPS)) / 10_000;
        if (uint256(after) < lo || uint256(after) > hi) revert ClearingPriceMismatch();
    }
```

- [ ] **Step 5: Run and confirm they pass**

Run: `forge test --root contracts --match-contract BellOpeningAuctionEscrowTest -vv`
Expected: PASS (13 tests). If `test_settle_directMatch_needsNoPoolSwap` reports a non-zero `lastAmountIn`, fix the book values in that test so the two sides net exactly — the assertion, not the implementation, is the thing being pinned.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/auction/BellOpeningAuction.sol contracts/src/libraries/AuctionClearing.sol contracts/test/BellOpeningAuction.t.sol
git commit -m "feat(auction): settle at one uniform price and verify the residual against it"
```

---

### Task 5: Claims and refunds

**Files:**
- Modify: `contracts/src/auction/BellOpeningAuction.sol`
- Test: `contracts/test/BellOpeningAuction.t.sol`

**Interfaces:**
- Consumes: Task 4's `_payouts`, `_settled`, `_refunded`.
- Produces: `claimBase(uint32)`, `claimQuote(uint32)`, `claimRefund(uint32)`, `claimRefundAll(uint32[])`, `refund()`, errors `NotSettled()`, `RefundNotOpen()`, `AlreadyClaimed()`.

- [ ] **Step 1: Write the failing claim tests**

```solidity
    function test_claimAfterSettle_paysOutAndBlocksDoubleClaim() public {
        _seedTwoSidedBook();
        vm.warp(OPEN_TIME);
        auction.lock();
        auction.settle(1 << 96);

        // Bob is the seller, so he claims the quote token (token0).
        uint256 before = token0.balanceOf(bob);
        vm.prank(bob);
        auction.claimQuote(1);
        assertEq(token0.balanceOf(bob), before + 100e18);

        vm.prank(bob);
        vm.expectRevert(BellOpeningAuction.NotClaimable.selector);
        auction.claimQuote(1);
    }

    function test_claimBuyer_receivesBase() public {
        _seedTwoSidedBook();
        vm.warp(OPEN_TIME);
        auction.lock();
        auction.settle(1 << 96);

        uint256 before = token1.balanceOf(alice);
        vm.prank(alice);
        auction.claimBase(0);
        assertEq(token1.balanceOf(alice), before + 100e18);
    }

    function test_claimBeforeSettle_reverts() public {
        _seedTwoSidedBook();
        vm.warp(OPEN_TIME);
        auction.lock();
        vm.prank(bob);
        vm.expectRevert(BellOpeningAuction.NotSettled.selector);
        auction.claimQuote(1);
    }

    function test_refundOpenAfterTimeout_returnsEscrow() public {
        _seedTwoSidedBook();
        vm.warp(OPEN_TIME + 901);
        assertFalse(auction.blocksSwaps());
        auction.refund();
        assertEq(auction.stage(), uint8(4)); // REFUNDED

        uint256 before = token1.balanceOf(bob);
        vm.prank(bob);
        auction.claimRefund(1);
        assertEq(token1.balanceOf(bob), before + 100e18);
    }

    function test_refund_revertsBeforeTimeout() public {
        vm.warp(OPEN_TIME + 10);
        vm.expectRevert(BellOpeningAuction.RefundNotOpen.selector);
        auction.refund();
    }

    function test_claimRefund_permissionlessAfterRefund() public {
        _seedTwoSidedBook();
        vm.warp(OPEN_TIME + 901);
        auction.refund();
        // Anyone may trigger a refund to its owner; funds can never be stranded by the owner.
        uint256 before = token1.balanceOf(bob);
        vm.prank(address(0xDEAD));
        auction.claimRefund(1);
        assertEq(token1.balanceOf(bob), before + 100e18);
    }
```

- [ ] **Step 2: Run and confirm they fail**

Run: `forge test --root contracts --match-contract BellOpeningAuctionEscrowTest -vv`
Expected: FAIL — `claimBase`, `refund`, `NotSettled`, `RefundNotOpen`, `AlreadyClaimed` not found.

- [ ] **Step 3: Implement claims and refunds**

```solidity
    error NotSettled();
    error RefundNotOpen();
    error NotClaimable();

    /// @notice Open the refund path once settle() has missed its window.
    /// @dev Deliberately permissionless and independent of SafetyController.
    function refund() external {
        if (_settled) revert AlreadySettled();
        if (block.timestamp < openTime + settleTimeout) revert RefundNotOpen();
        _refunded = true;
    }

    /// @notice Withdraw the base a buy order was filled for.
    function claimBase(uint32 id) external {
        if (!_settled) revert NotSettled();
        Payout storage p = _payouts[id];
        if (!p.claimable || p.baseOut == 0) revert NotClaimable();
        uint128 amount = p.baseOut;
        p.baseOut = 0;
        p.claimable = false;
        IERC20(token1).safeTransfer(_orders[id].owner, amount);
    }

    /// @notice Withdraw the quote a sell order was filled for.
    function claimQuote(uint32 id) external {
        if (!_settled) revert NotSettled();
        Payout storage p = _payouts[id];
        if (!p.claimable || p.quoteOut == 0) revert NotClaimable();
        uint128 amount = p.quoteOut;
        p.quoteOut = 0;
        p.claimable = false;
        IERC20(token0).safeTransfer(_orders[id].owner, amount);
    }

    /// @notice Return an escrowed order in full once the refund window is open.
    /// @dev Permissionless: the funds always go to `owner`, so a third party can only help.
    function claimRefund(uint32 id) public {
        if (!_refunded) revert RefundNotOpen();
        Order storage o = _orders[id];
        if (o.gone) revert OrderAlreadyGone();
        o.gone = true;
        IERC20(o.zeroForOne ? token0 : token1).safeTransfer(o.owner, o.amountIn);
    }

    /// @notice Convenience batch over `claimRefund`.
    function claimRefundAll(uint32[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) claimRefund(ids[i]);
    }
```

- [ ] **Step 4: Run and confirm they pass**

Run: `forge test --root contracts --match-contract BellOpeningAuctionEscrowTest -vv`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/auction/BellOpeningAuction.sol contracts/test/BellOpeningAuction.t.sol
git commit -m "feat(auction): add settlement claims and the permissionless refund path"
```

---

### Task 6: Loss-of-funds coverage and operator docs

**Files:**
- Modify: `contracts/test/LossOfFundsIndex.t.sol`
- Create: `docs/superpowers/specs/2026-11-05-opening-bell-auction-limits.md`

**Interfaces:**
- Consumes: every error introduced in Tasks 1–5.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend the loss-of-funds index**

Add one row per vector to `LossOfFundsIndex.t.sol`, each naming the test that proves it:

```solidity
    // Opening Bell Auction — see docs/superpowers/specs/2026-11-05-opening-bell-auction-limits.md
    // Every row below names a test that exists in this plan. The residual-cap and halted-settle
    // vectors need a real pool and are indexed by Plan B, not here.
    // escrowDrain          -> BellOpeningAuctionEscrowTest.test_claimAfterSettle_paysOutAndBlocksDoubleClaim
    // buyerClaim           -> BellOpeningAuctionEscrowTest.test_claimBuyer_receivesBase
    // claimBeforeSettle    -> BellOpeningAuctionEscrowTest.test_claimBeforeSettle_reverts
    // cancelByNonOwner     -> BellOpeningAuctionEscrowTest.test_cancelOrder_revertsForNonOwner
    // cancelAfterCutoff    -> BellOpeningAuctionEscrowTest.test_cancelOrder_revertsAfterCutoff
    // limitViolation       -> BellOpeningAuctionEscrowTest.test_settle_rejectsPriceOutsideLimit
    // refundTimeout        -> BellOpeningAuctionEscrowTest.test_refundOpenAfterTimeout_returnsEscrow
    // refundTooEarly       -> BellOpeningAuctionEscrowTest.test_refund_revertsBeforeTimeout
    // refundPermissionless -> BellOpeningAuctionEscrowTest.test_claimRefund_permissionlessAfterRefund
```

- [ ] **Step 2: Run the index**

Run: `forge test --root contracts --match-contract LossOfFundsIndex -vv`
Expected: PASS. If a named test does not exist yet, add it to `BellOpeningAuction.t.sol` before touching the index — an index row without a test is worse than no row.

- [ ] **Step 3: Write the limits document**

```markdown
# Opening Bell Auction — acknowledged limits

- Escrow is custodial for the length of the window. `cancel` (before cutoff) and `claimRefund`
  (after timeout) are permissionless and outside every pausable path, but the funds sit in the
  contract meanwhile. Product copy must not claim otherwise.
- Clearing needs two-sided flow. With a one-sided book the batch degenerates into one pool swap,
  which is no better than today. This is a property of the design, not a defect.
- The solver proposes the clearing price; the contract verifies it. A poor proposal reverts or
  leaves orders unfilled and refundable — it cannot move funds to the proposer.
- Orders are public from submission, so last-block sniping is possible in v1. Commit/reveal is
  explicitly out of scope.
```

- [ ] **Step 4: Run the whole contract suite**

Run: `forge test --root contracts`
Expected: PASS — no regressions, new tests passing.

- [ ] **Step 5: Commit**

```bash
git add contracts/test/LossOfFundsIndex.t.sol docs/superpowers/specs/2026-11-05-opening-bell-auction-limits.md
git commit -m "test(auction): index the new loss-of-funds vectors and record the acknowledged limits"
```

---

## Self-review notes

- **Spec coverage:** escrow (Task 1), swap gating and the reopen-on-refund rule (Task 2), uniform-price netting (Tasks 3–4), permissionless settle (Task 4), permissionless and unpausable refunds (Task 5), loss-of-funds index and disclosure (Task 6). `auctionResidualCap` is enforced in Task 4. `auctionFeeBps = 0` is honoured by having no fee code at all.
- **Deferred to Plan B:** the hook's `blocksSwaps()` guard, `BellPoolFactoryV2` deploying one auction per pool, and the real `IAuctionResidualAdapter` over `BellRouter`.
- **Deferred to Plan C:** the `/auction` page and the keeper's `settle()` call.
- **Known sharp edge:** the two classification loops in Task 4 Step 3 are written longhand on purpose so the implementer sees the shape; the implementer note says to collapse them into one pass. The payout test is the specification.

