// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EinsteinPoolRehearsal, Vm, IPositionManagerLite} from "./EinsteinPoolRehearsal.t.sol";
import {BellPolicyOracleV3} from "../../src/BellPolicyOracleV3.sol";
import {HaltRegistry, IHaltHybridAuth} from "../../src/registries/HaltRegistry.sol";
import {IBellHook} from "../../src/interfaces/IBellProtocol.sol";
import {PolicyView, Mode} from "../../src/types/ProtocolTypes.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Actions} from "../../lib/v4-periphery/src/libraries/Actions.sol";

interface IVmEtch {
    function etch(address target, bytes calldata code) external;
}

interface IDeployerOracle {
    function policyOracle() external view returns (address);
}

/// @dev Stands in for HybridAuth. The signature check is not what these tests are about; HaltRegistry.t.sol covers that it is called.
contract ForkHaltAuth {
    function authorize(bytes32, bytes32, bytes32, uint256 deadline, bytes calldata e, bytes calldata p) external view returns (uint32) {
        require(block.timestamp <= deadline && e.length != 0 && p.length != 0, "hybrid");
        return 1;
    }
}

/// @notice Einstein Hooks v3 rehearsal against a fork of Robinhood mainnet. The real factory, hook deployer, session registry, calendar
///         and pool manager create a real pool; the deployer's policy oracle address is then given BellPolicyOracleV3's runtime code,
///         which is what a freshly deployed V3 stack would run, and a recorded halt is applied. Nothing broadcasts. Run with:
///         forge test --match-contract EinsteinHaltRehearsal --match-test test_V --fork-url $RH_MAINNET_RPC_SECONDARY -vv
contract EinsteinHaltRehearsal is EinsteinPoolRehearsal {
    bytes32 private constant REASON = keccak256("LULD");
    HaltRegistry internal reg;

    function _withHaltOracle() internal {
        _create();
        reg = new HaltRegistry(IHaltHybridAuth(address(new ForkHaltAuth())), keccak256("REPORTER"));
        BellPolicyOracleV3 v3 = new BellPolicyOracleV3(address(reg));
        address realOracle = IDeployerOracle(address(DEPLOYER)).policyOracle();
        IVmEtch(address(vm)).etch(realOracle, address(v3).code);
    }

    function _halt() internal {
        reg.halt(NVDA_ID, 1, uint64(block.timestamp) - 60, REASON, block.timestamp + 600, hex"01", hex"02");
    }

    function _swapFee() internal returns (uint24 fee) {
        vm.startPrank(creator);
        IERC20(USDG).approve(address(swapper), type(uint256).max);
        IERC20(NVDA).approve(address(swapper), type(uint256).max);
        vm.recordLogs();
        swapper.swap(key, true, -int256(uint256(0.015e6)));
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == SWAP_TOPIC) {
                (, , , , , fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                return fee;
            }
        }
        revert("no Swap event");
    }

    function test_V1_aSwapDuringAHaltPaysTheClosedFee() external {
        _withHaltOracle();
        PolicyView memory before_ = IBellHook(pool.hook).getPolicy();
        emitUint("mode before halt", before_.mode);
        emitUint("fee before halt (pips)", before_.lpFeeUnits);
        _halt();
        PolicyView memory view_ = IBellHook(pool.hook).getPolicy();
        assertEq(view_.mode, uint8(Mode.CLOSED), "view mode is not CLOSED");
        PolicyView memory p = IBellHook(pool.hook).refreshState();
        assertEq(p.mode, uint8(Mode.CLOSED), "checkpoint mode is not CLOSED");
        require(p.canSwap, "swaps are blocked during the halt");
        uint24 fee = _swapFee();
        emitUint("Swap event fee during halt (pips)", fee);
        assertEq(fee, 10000, "swap fee is not the CLOSED fee");
    }

    function test_V6_anExitDuringAHaltNeverTouchesTheHook() external {
        _withHaltOracle();
        _halt();
        IBellHook(pool.hook).refreshState();
        vm.startPrank(creator);
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(pool.tokenId, uint256(pool.liquidity), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(USDG), Currency.wrap(NVDA), creator);
        uint256 before0 = IERC20(USDG).balanceOf(creator);
        IPositionManagerLite(POSITION_MANAGER).modifyLiquidities(abi.encode(actions, params), block.timestamp + 600);
        vm.stopPrank();
        assertGt(IERC20(USDG).balanceOf(creator), before0, "got USDG back during the halt");
    }
}
