// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Receives BELL pool creation fees on Elysium and splits them three ways.
/// @dev Immutable: three recipients and their shares are fixed in the constructor, there is no owner, no setter and
/// no proxy. `distribute` can be called by anyone. It pays the whole balance, and the rounding remainder goes to the
/// last recipient, so no dust is ever left behind.
///
/// It touches creation fees only. Swap fees belong to liquidity providers and never pass through here: this contract
/// is set as the factory's service recipient and nothing else.
contract ElysiumFeeSplitter {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant RECIPIENTS = 3;

    /// @notice Buyback of $BELL, buyback of $KNTQ, treasury. Each is an address that executes or holds, not a swap router.
    address public immutable bellBuyback;
    address public immutable kntqBuyback;
    address public immutable treasury;
    uint16 public immutable bellBps;
    uint16 public immutable kntqBps;
    uint16 public immutable treasuryBps;

    event Distributed(address indexed token, address indexed recipient, uint256 amount, uint16 bps);
    event Round(address indexed token, address indexed caller, uint256 total);

    error ZeroAddress();
    error DuplicateRecipient();
    error SharesMustSumToTenThousand();
    error ZeroShare();
    error NothingToDistribute();

    constructor(
        address bellBuyback_,
        address kntqBuyback_,
        address treasury_,
        uint16 bellBps_,
        uint16 kntqBps_,
        uint16 treasuryBps_
    ) {
        if (bellBuyback_ == address(0) || kntqBuyback_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (bellBuyback_ == kntqBuyback_ || bellBuyback_ == treasury_ || kntqBuyback_ == treasury_) {
            revert DuplicateRecipient();
        }
        if (bellBps_ == 0 || kntqBps_ == 0 || treasuryBps_ == 0) revert ZeroShare();
        if (uint256(bellBps_) + kntqBps_ + treasuryBps_ != BPS) revert SharesMustSumToTenThousand();
        bellBuyback = bellBuyback_;
        kntqBuyback = kntqBuyback_;
        treasury = treasury_;
        bellBps = bellBps_;
        kntqBps = kntqBps_;
        treasuryBps = treasuryBps_;
    }

    /// @notice Splits this contract's whole balance of `token`. Anyone may call it.
    function distribute(IERC20 token) external {
        uint256 total = token.balanceOf(address(this));
        if (total == 0) revert NothingToDistribute();
        uint256 toBell = total * bellBps / BPS;
        uint256 toKntq = total * kntqBps / BPS;
        uint256 toTreasury = total - toBell - toKntq; // takes the rounding remainder: nothing stays here
        emit Round(address(token), msg.sender, total);
        _pay(token, bellBuyback, toBell, bellBps);
        _pay(token, kntqBuyback, toKntq, kntqBps);
        _pay(token, treasury, toTreasury, treasuryBps);
    }

    function _pay(IERC20 token, address to, uint256 amount, uint16 bps) private {
        if (amount == 0) return;
        token.safeTransfer(to, amount);
        emit Distributed(address(token), to, amount, bps);
    }
}
