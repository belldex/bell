// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PositionReceipt, IPositionReceiptManager} from "../../../src/libraries/PositionReceipt.sol";

contract PositionReceiptMock is IPositionReceiptManager {
    address public owner;
    PoolKey private _key;
    uint256 private _info;
    uint128 public liquidity;

    function set(address owner_, PoolKey calldata key_, int24 tickLower, int24 tickUpper, uint128 liquidity_) external {
        owner = owner_;
        _key = key_;
        uint256 raw = uint256(uint24(tickLower)) << 8 | uint256(uint24(tickUpper)) << 32;
        _info = raw;
        liquidity = liquidity_;
    }

    function ownerOf(uint256) external view returns (address) { return owner; }
    function getPoolAndPositionInfo(uint256) external view returns (PoolKey memory, uint256) { return (_key, _info); }
    function getPositionLiquidity(uint256) external view returns (uint128) { return liquidity; }
}

contract PositionReceiptHarness {
    function verify(
        IPositionReceiptManager manager,
        uint256 tokenId,
        address recipient,
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) external view {
        PositionReceipt.verifyPublicPosition(manager, tokenId, recipient, key, tickLower, tickUpper, liquidity);
    }
}

contract PositionReceiptTest {
    PositionReceiptMock private manager;
    PositionReceiptHarness private harness;
    address private constant RECIPIENT = address(0xBEEF);
    address private constant HOOK = address(0x1234);

    function setUp() external {
        manager = new PositionReceiptMock();
        harness = new PositionReceiptHarness();
    }

    function testAcceptsReceiptOnlyWhenOwnerPoolTicksAndLiquidityMatch() external {
        PoolKey memory key = _key();
        manager.set(RECIPIENT, key, -120, 120, 1_000_000);
        harness.verify(manager, 7, RECIPIENT, key, -120, 120, 1_000_000);
    }

    function testRejectsWrongOwner() external {
        PoolKey memory key = _key();
        manager.set(address(0xCAFE), key, -120, 120, 1_000_000);
        _expectInvalid(RECIPIENT, key, -120, 120, 1_000_000);
    }

    function testRejectsWrongPoolOrTicks() external {
        PoolKey memory key = _key();
        manager.set(RECIPIENT, key, -120, 120, 1_000_000);
        PoolKey memory other = key;
        other.fee = 3000;
        _expectInvalid(RECIPIENT, other, -120, 120, 1_000_000);
        _expectInvalid(RECIPIENT, key, -240, 120, 1_000_000);
    }

    function testRejectsWrongLiquidityAndZeroTokenId() external {
        PoolKey memory key = _key();
        manager.set(RECIPIENT, key, -120, 120, 1_000_000);
        _expectInvalid(RECIPIENT, key, -120, 120, 999_999);
        (bool ok,) = address(harness).call(abi.encodeCall(
            harness.verify, (manager, 0, RECIPIENT, key, int24(-120), int24(120), uint128(1_000_000))
        ));
        require(!ok, "zero token id accepted");
    }

    function _expectInvalid(address recipient, PoolKey memory key, int24 lower, int24 upper, uint128 liquidity_) private {
        (bool ok, bytes memory data) = address(harness).call(abi.encodeCall(
            harness.verify, (manager, 7, recipient, key, lower, upper, liquidity_)
        ));
        require(!ok && bytes4(data) == PositionReceipt.InvalidPositionReceipt.selector, "receipt mismatch accepted");
    }

    function _key() private pure returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(address(0x100)),
            currency1: Currency.wrap(address(0x200)),
            fee: 0x800000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });
    }
}
