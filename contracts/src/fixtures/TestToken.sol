// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet-only token for the BELL Elysium rehearsal: `tAAPL (BELL test)` and `tUSDG (BELL test)`.
/// @dev It is not an asset of any issuer and has no value. Two guards keep it that way:
///  - the constructor refuses any name that does not end in "(BELL test)", so a deployment cannot pass for a real asset;
///  - the deploy script refuses to broadcast it on a mainnet chain id.
/// It exposes the same corporate-status getters as the Robinhood stock tokens so the status adapters read it the way
/// they read a real one. Minting is owner-only; `faucet()` hands each address a fixed amount once per day.
contract TestToken is ERC20 {
    string private constant SUFFIX = "(BELL test)";
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    uint8 private immutable _decimals;
    address public immutable owner;
    uint256 public immutable faucetAmount;
    mapping(address account => uint256 timestamp) public lastFaucet;

    error NotOwner();
    error NameMustEndInBellTest();
    error FaucetCooldown(uint256 availableAt);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_, uint256 faucetAmount_)
        ERC20(name_, symbol_)
    {
        if (!_endsWith(bytes(name_), bytes(SUFFIX))) revert NameMustEndInBellTest();
        _decimals = decimals_;
        owner = owner_;
        faucetAmount = faucetAmount_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        _mint(to, amount);
    }

    function faucet() external {
        uint256 availableAt = lastFaucet[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucet[msg.sender] != 0 && block.timestamp < availableAt) revert FaucetCooldown(availableAt);
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
    }

    // Corporate-status getters, constant: a test token never splits and its oracle never pauses.
    function uiMultiplier() external pure returns (uint256) {
        return 1e18;
    }

    function newUIMultiplier() external pure returns (uint256) {
        return 1e18;
    }

    function effectiveAt() external pure returns (uint256) {
        return 0;
    }

    function oraclePaused() external pure returns (bool) {
        return false;
    }

    function _endsWith(bytes memory s, bytes memory suffix) private pure returns (bool) {
        if (s.length < suffix.length) return false;
        uint256 offset = s.length - suffix.length;
        for (uint256 i; i < suffix.length; ++i) {
            if (s[offset + i] != suffix[i]) return false;
        }
        return true;
    }
}
