// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TreasuryAdapter} from "../../../src/TreasuryAdapter.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {CreateRequest, PoolConfig} from "../../../src/types/ProtocolTypes.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface VmFuzz {
    function prank(address) external;
    function warp(uint256) external;
}

contract FuzzToken is ERC20 {
    constructor() ERC20("Fuzz Fixture", "FZF") {}
}

/// @dev Fuzz boundaries for the TreasuryAdapter trust surface (M13-01 partial, adapter lane).
/// The setUp stays deliberately minimal and the adapter is never seeded here: every fuzzed entry
/// point must fail closed against an unseeded, unbound adapter.
contract TreasuryAdapterFuzzTest {
    VmFuzz private constant vm = VmFuzz(address(uint160(uint256(keccak256("hevm cheat code")))));

    PoolManager internal manager;
    FuzzToken internal tokenA;
    FuzzToken internal tokenB;
    TreasuryAdapter internal adapter;
    address internal constant FACTORY = address(0xFA0);
    address internal constant TREASURY = address(0xA11CE);
    address internal constant RECIPIENT = address(0xBEEF);

    function setUp() external {
        manager = new PoolManager(address(this));
        FuzzToken a = new FuzzToken();
        FuzzToken b = new FuzzToken();
        (tokenA, tokenB) = address(a) < address(b) ? (a, b) : (b, a);
        // hook has no code: any path that would reach it must already have failed closed earlier.
        adapter = new TreasuryAdapter(manager, FACTORY, TREASURY, RECIPIENT, address(1),
            Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)), 60);
    }

    function testFuzz_ConstructorTrustBoundaries(
        address factory_, address treasury_, address recipient_, address hook_, int24 tickSpacing_
    ) external {
        try new TreasuryAdapter(manager, factory_, treasury_, recipient_, hook_,
            Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)), tickSpacing_) returns (TreasuryAdapter a) {
            require(factory_ != address(0) && treasury_ != address(0) && recipient_ != address(0)
                && recipient_ != address(a) && treasury_ != address(a) && hook_ != address(0)
                && tickSpacing_ > 0, "deployed despite invalid binding");
            require(a.factory() == factory_ && a.treasury() == treasury_ && a.recipient() == recipient_
                && a.hook() == hook_ && a.tickSpacing() == tickSpacing_, "immutable binding corrupted");
        } catch (bytes memory reason) {
            require(bytes4(reason) == TreasuryAdapter.InvalidConfiguration.selector, "unexpected constructor revert");
        }
    }

    function testFuzz_UnseededRemoveAlwaysReverts(bytes32 key_, uint128 liquidity, uint64 deadline) external {
        vm.prank(TREASURY);
        (bool ok, bytes memory reason) = address(adapter).call(
            abi.encodeCall(adapter.remove, (key_, liquidity, uint128(0), uint128(0), deadline)));
        require(!ok, "unseeded remove succeeded");
        bytes4 sel = bytes4(reason);
        require(sel == TreasuryAdapter.BadSeed.selector || sel == TreasuryAdapter.DeadlineExpired.selector,
            "unexpected remove revert");
    }

    function testFuzz_UnseededCollectAlwaysReverts(bytes32 key_, uint128 f0, uint128 f1, uint64 deadline) external {
        vm.prank(TREASURY);
        (bool ok, bytes memory reason) = address(adapter).call(
            abi.encodeCall(adapter.collect, (key_, f0, f1, deadline)));
        require(!ok, "unseeded collect succeeded");
        bytes4 sel = bytes4(reason);
        require(sel == TreasuryAdapter.BadSeed.selector || sel == TreasuryAdapter.DeadlineExpired.selector,
            "unexpected collect revert");
    }

    function testFuzz_SeedNonFactoryAlwaysReverts(address caller, bytes32 requestHash) external {
        if (caller == FACTORY) return;
        CreateRequest memory request = _validShapedRequest();
        vm.prank(caller);
        (bool ok, bytes memory reason) = address(adapter).call(
            abi.encodeCall(adapter.seed, (requestHash, request)));
        require(!ok && bytes4(reason) == TreasuryAdapter.Unauthorized.selector, "non-factory seed");
    }

    function testFuzz_PositionKeyIsDeterministicAndDistinct(int24 tickLower, int24 tickUpper, bytes32 salt) external view {
        bytes32 k = adapter.positionKey(tickLower, tickUpper, salt);
        require(k == adapter.positionKey(tickLower, tickUpper, salt), "key unstable");
        require(k != adapter.positionKey(tickLower, tickUpper, bytes32(uint256(salt) ^ 1)), "salt unbound");
        require(k != adapter.positionKey(tickLower == type(int24).min ? type(int24).max : tickLower - 1, tickUpper, salt),
            "tickLower unbound");
        // Formula matches the normative binding pool/ticks/salt/adapter.
        PoolKey memory key = PoolKey(Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)),
            LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(1)));
        bytes32 expected = keccak256(abi.encodePacked(
            PoolId.unwrap(PoolIdLibrary.toId(key)), tickLower, tickUpper, salt, address(adapter)));
        require(k == expected, "key formula drift");
    }

    function _validShapedRequest() private view returns (CreateRequest memory) {
        PoolConfig memory config = PoolConfig({
            token0: address(tokenA), token1: address(tokenB),
            asset0: bytes32(uint256(1)), asset1: bytes32(uint256(2)),
            poolManager: address(manager), positionManager: address(manager), factory: FACTORY,
            assetRegistry: address(1), calendarRegistry: address(2), safetyController: address(3),
            treasuryAdapter: address(adapter), poolClass: 1, liquidityMode: 1, referenceMode: 0,
            tickSpacing: 60, tradeCap: [uint128(10), uint128(10)], windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)], policyId: keccak256("fuzz")
        });
        return CreateRequest({
            config: config, salt: bytes32(uint256(7)), nonce: 0, deadline: uint64(block.timestamp + 1000),
            recipient: RECIPIENT, sqrtPriceX96: uint160(1 << 96), tickLower: -120, tickUpper: 120,
            liquidity: 1000, amountMax: [uint128(1), uint128(1)], maxServiceFee: 0
        });
    }
}
