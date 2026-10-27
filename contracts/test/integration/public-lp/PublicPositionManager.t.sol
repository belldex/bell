// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPoolFactoryTest} from "../factory/BellPoolFactory.t.sol";
import {BellHook} from "../../../src/BellHook.sol";
import {CreateResult, CalendarLeaf, Anchor, Mode} from "../../../src/types/ProtocolTypes.sol";
import {MockCalendarRegistry, MockSafetyController} from "../../unit/hook/BellHookLifecycle.t.sol";
import {ModePolicy} from "../../../src/libraries/ModePolicy.sol";
import {CalendarProof} from "../../../src/libraries/CalendarProof.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Actions} from "../../../lib/v4-periphery/src/libraries/Actions.sol";

interface VmPublicLP {
    function prank(address) external;
    function warp(uint256) external;
    function mockCall(address,bytes calldata,bytes calldata) external;
    function store(address,bytes32,bytes32) external;
}

/// @dev Real pinned PM/core; shares the explicitly synthetic Permit2/registry fixture.
contract PublicPositionManagerTest is BellPoolFactoryTest {
    VmPublicLP private constant vmLP = VmPublicLP(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testPublicOwnerIncreaseDoesNotRecaptureSeedOrReactivate() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        bytes32 stateBefore = keccak256(abi.encode(hook.state(), hook.buckets(), hook.seedPrincipal(), hook.config()));
        _fund(RECIPIENT);
        bytes[] memory p = new bytes[](2);
        p[0] = abi.encode(r.tokenId, uint256(100000), uint128(10000), uint128(10000), bytes(""));
        p[1] = abi.encode(hook.poolKey().currency0, hook.poolKey().currency1);
        vmLP.prank(RECIPIENT);
        positions.modifyLiquidities(abi.encode(abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY),uint8(Actions.SETTLE_PAIR)),p),request.deadline);
        require(positions.getPositionLiquidity(r.tokenId) == request.liquidity + 100000,"increase missing");
        require(positions.ownerOf(r.tokenId) == RECIPIENT,"custody changed");
        require(stateBefore == keccak256(abi.encode(hook.state(), hook.buckets(), hook.seedPrincipal(), hook.config())),"seed/state changed");
        require(factory.nonces(address(this)) == 1 && hook.getPolicy().mode != uint8(Mode.RECOVERING),"request/swap changed");
    }

    function testPublicApprovedExecutorPaysOwnFundsNotOwners() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        _fund(RECIPIENT);
        vmLP.prank(RECIPIENT); positions.approve(address(this),r.tokenId);
        // Owner's Permit2 approvals cannot be selected as a payer by the approved executor.
        _fail(hook,address(this),_modify(hook,r.tokenId,100000,10000,10000,true,RECIPIENT),request.deadline);
        uint256 owner0 = token0.balanceOf(RECIPIENT);
        _fund(address(this));
        _run(address(this),_modify(hook,r.tokenId,100000,10000,10000,true,RECIPIENT),request.deadline);
        require(token0.balanceOf(RECIPIENT) == owner0,"owner was payer");
        require(positions.getPositionLiquidity(r.tokenId) == 1100000,"approved increase");
        // Approval authorizes in-kind payouts to an explicitly chosen recipient too.
        _run(address(this),_modify(hook,r.tokenId,100000,0,0,false,RECIPIENT),request.deadline);
        require(token0.balanceOf(RECIPIENT) > owner0,"approved withdrawal");
    }

    function testPublicOperatorApprovalAndTransferredOwnerAuthority() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        vmLP.prank(RECIPIENT); positions.setApprovalForAll(address(this),true);
        _run(address(this),_modify(hook,r.tokenId,100000,0,0,false,RECIPIENT),request.deadline);
        vmLP.prank(RECIPIENT); positions.transferFrom(RECIPIENT,address(0xCAFE),r.tokenId);
        _fail(hook,RECIPIENT,_modify(hook,r.tokenId,100000,0,0,false,RECIPIENT),request.deadline);
        _run(address(0xCAFE),_modify(hook,r.tokenId,100000,0,0,false,address(0xCAFE)),request.deadline);
    }

    function testPublicUnauthorizedIncreaseRemoveCollectAndRecipientTheftAreAtomic() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        _fund(address(this));
        _fail(hook,address(this),_modify(hook,r.tokenId,100000,10000,10000,true,address(this)),request.deadline);
        _fail(hook,address(this),_modify(hook,r.tokenId,100000,0,0,false,address(this)),request.deadline);
        _fail(hook,address(this),_modify(hook,r.tokenId,0,0,0,false,address(this)),request.deadline);
        _fail(hook,RECIPIENT,_modify(hook,r.tokenId + 1,100000,0,0,false,RECIPIENT),request.deadline);
    }

    function testPublicSlippageDeadlineAndSettlementFailuresAreAtomic() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        _fund(RECIPIENT);
        _fail(hook,RECIPIENT,_modify(hook,r.tokenId,100000,1,10000,true,RECIPIENT),request.deadline);
        _fail(hook,RECIPIENT,_modify(hook,r.tokenId,100000,10000,1,true,RECIPIENT),request.deadline);
        _fail(hook,RECIPIENT,_modify(hook,r.tokenId,100000,10000,0,false,RECIPIENT),request.deadline);
        _fail(hook,RECIPIENT,_modify(hook,r.tokenId,100000,0,10000,false,RECIPIENT),request.deadline);
        _fail(hook,RECIPIENT,_modify(hook,r.tokenId,100000,0,0,false,RECIPIENT),block.timestamp - 1);
        _fail(hook,RECIPIENT,_modify(hook,r.tokenId,uint256(request.liquidity)+1,0,0,false,RECIPIENT),request.deadline);
        // Fail the second payment after token0 has actually settled; the entire unlock must roll back.
        vmLP.prank(RECIPIENT); permit2.approve(address(token1),address(positions),0,0);
        _fail(hook,RECIPIENT,_modify(hook,r.tokenId,100000,10000,10000,true,RECIPIENT),request.deadline);
    }

    function testPublicExplicitAdditionalMintAndBadTicksRecipientKeyContext() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        _fund(RECIPIENT);
        bytes32 checkpoint = _hookSnapshot(hook);
        _fail(hook,RECIPIENT,_mint(hook.poolKey(),-119,120,RECIPIENT,bytes("")),request.deadline);
        _fail(hook,RECIPIENT,_mint(hook.poolKey(),120,-120,RECIPIENT,bytes("")),request.deadline);
        _fail(hook,RECIPIENT,_mint(hook.poolKey(),-120,120,address(0),bytes("")),request.deadline);
        _fail(hook,RECIPIENT,_mint(hook.poolKey(),-120,120,RECIPIENT,abi.encode(address(factory))),request.deadline);
        PoolKey memory wrong = hook.poolKey(); wrong.tickSpacing = 10;
        _fail(hook,RECIPIENT,_mint(wrong,-120,120,RECIPIENT,bytes("")),request.deadline);
        _run(RECIPIENT,_mint(hook.poolKey(),-180,180,address(0xCAFE),bytes("")),request.deadline);
        require(positions.ownerOf(2) == address(0xCAFE) && positions.getPositionLiquidity(2) == 100000,"explicit mint receipt");
        require(_hookSnapshot(hook) == checkpoint,"mint recaptured seed");
    }

    function testPublicUntrustedCoreMutationAndSpoofedManagerContextFail() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        PoolKey memory key = hook.poolKey();
        ModifyLiquidityParams memory p = ModifyLiquidityParams(-120,120,100000,bytes32(r.tokenId));
        (bool ok,) = address(manager).call(abi.encodeCall(manager.unlock,(abi.encode(false,key,p))));
        require(!ok,"direct core add allowed");
        // Even the claimed PM address is insufficient outside its protected locker context.
        vmLP.prank(address(manager));
        (ok,) = r.hook.call(abi.encodeCall(IHooks.beforeAddLiquidity,(address(positions),key,p,bytes(""))));
        require(!ok,"inactive PM context accepted");
        key.fee = 0;
        vmLP.prank(address(manager));
        (ok,) = r.hook.call(abi.encodeCall(IHooks.beforeAddLiquidity,(address(positions),key,p,bytes(""))));
        require(!ok,"wrong key accepted");
    }

    function testPublicInKindExitWhilePoolAndAssetPaused() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        MockSafetyController safety = MockSafetyController(request.config.safetyController);
        safety.setPause(ModePolicy.targetId(1,r.hook),true,1);
        safety.setPause(ModePolicy.targetId(2,address(token0)),true,1);
        hook.refreshState();
        _collectThenExit(hook,r.tokenId);
    }

    function testPublicInKindExitWithStaleHealthAndCalendar() external {
        CreateResult memory r = factory.createAndSeed(request);
        vmLP.warp(20001);
        BellHook hook = BellHook(r.hook); hook.refreshState();
        _collectThenExit(hook,r.tokenId);
    }

    function testPublicInKindExitWithAllBellDependenciesUnavailable() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        assets.setRevertReads(true); sessions.setRevertReads(true);
        MockCalendarRegistry(request.config.calendarRegistry).setRevertReads(true);
        MockSafetyController(request.config.safetyController).setRevertReads(true);
        hook.refreshState();
        _collectThenExit(hook,r.tokenId);
    }

    function testPublicInKindExitClosedLatchedAndExhaustedBudgets() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        CalendarLeaf memory leaf = CalendarLeaf(request.config.asset0,2026,1,9999,20000,5,bytes32(uint256(1)));
        MockCalendarRegistry(request.config.calendarRegistry).setLeaf(leaf);
        bytes32 boundary = CalendarProof.hashLeaf(block.chainid,request.config.calendarRegistry,leaf);
        Anchor memory anchor = Anchor(request.config.asset0,boundary,100e18,1e18,9998,9997,9997,9999,bytes32(uint256(1)));
        vmLP.mockCall(address(sessions),abi.encodeWithSignature("anchorStatus(bytes32,bytes32)",request.config.asset0,boundary),
            abi.encode(anchor,true,uint256(0),uint64(20000)));
        vmLP.mockCall(request.config.calendarRegistry,abi.encodeWithSignature("nextInterval(bytes32)",request.config.asset0),
            abi.encode(CalendarLeaf(request.config.asset0,2026,2,20000,21000,2,bytes32(uint256(1)))));
        hook.refreshState();
        require(hook.state().closedLatched && hook.state().mode == uint8(Mode.CLOSED),"not CLOSED");
        // TEST-ONLY accounting injection: swaps are deliberately disabled in production. Layout checked
        // with forge inspect: _buckets.currentGross slot 5; _episodeGross mapping slot 7.
        vmLP.store(r.hook,bytes32(uint256(5)),bytes32(uint256(100) | (uint256(100) << 128)));
        vmLP.store(r.hook,keccak256(abi.encode(uint64(1),uint256(7))),bytes32(uint256(1) | (uint256(1) << 128)));
        require(hook.getPolicy().rollingRemaining[0] == 0 && hook.getPolicy().closureRemaining[1] == 0,"not exhausted");
        _collectThenExit(hook,r.tokenId);
    }

    function _collectThenExit(BellHook hook,uint256 id) private {
        require(hook.getPolicy().mode != uint8(Mode.RECOVERING),"swap gate");
        // Real core donation distributes earned fees without enabling any swap path.
        manager.unlock(abi.encode(true,hook.poolKey(),ModifyLiquidityParams(0,0,0,bytes32(0))));
        bytes32 checkpoint = _hookSnapshot(hook);
        uint256 b0 = token0.balanceOf(RECIPIENT); uint256 b1 = token1.balanceOf(RECIPIENT);
        _run(RECIPIENT,_modify(hook,id,0,0,0,false,RECIPIENT),block.timestamp + 100);
        require(token0.balanceOf(RECIPIENT) > b0 && token1.balanceOf(RECIPIENT) > b1,"no actual fees collected");
        require(positions.getPositionLiquidity(id) == request.liquidity,"collect removed principal");
        b0 = token0.balanceOf(RECIPIENT); b1 = token1.balanceOf(RECIPIENT);
        _run(RECIPIENT,_modify(hook,id,request.liquidity,1,1,false,RECIPIENT),block.timestamp + 100);
        require(positions.getPositionLiquidity(id) == 0 && positions.ownerOf(id) == RECIPIENT,"exit custody/liquidity");
        require(token0.balanceOf(RECIPIENT) > b0 && token1.balanceOf(RECIPIENT) > b1,"not two-token in-kind");
        require(_hookSnapshot(hook) == checkpoint,"exit changed BELL state/budget/seed");
        require(token0.balanceOf(address(positions)) == 0 && token1.balanceOf(address(positions)) == 0,"PM residue");
    }

    function unlockCallback(bytes calldata data) external returns(bytes memory) {
        require(msg.sender == address(manager),"only core");
        (bool donation,PoolKey memory key,ModifyLiquidityParams memory p) = abi.decode(data,(bool,PoolKey,ModifyLiquidityParams));
        if (!donation) manager.modifyLiquidity(key,p,bytes(""));
        else {
            manager.donate(key,1000,2000,bytes(""));
            manager.sync(key.currency0); token0.transfer(address(manager),1000); manager.settle();
            manager.sync(key.currency1); token1.transfer(address(manager),2000); manager.settle();
        }
        return bytes("");
    }

    function _modify(BellHook hook,uint256 id,uint256 liquidity,uint128 a0,uint128 a1,bool increase,address recipient)
        private view returns(bytes memory)
    {
        bytes[] memory p = new bytes[](2);
        p[0] = abi.encode(id,liquidity,a0,a1,bytes(""));
        p[1] = increase ? abi.encode(hook.poolKey().currency0,hook.poolKey().currency1)
            : abi.encode(hook.poolKey().currency0,hook.poolKey().currency1,recipient);
        return abi.encode(abi.encodePacked(uint8(increase ? Actions.INCREASE_LIQUIDITY : Actions.DECREASE_LIQUIDITY),
            uint8(increase ? Actions.SETTLE_PAIR : Actions.TAKE_PAIR)),p);
    }

    function _mint(PoolKey memory key,int24 lower,int24 upper,address recipient,bytes memory context) private pure returns(bytes memory) {
        bytes[] memory p = new bytes[](2);
        p[0] = abi.encode(key,lower,upper,uint256(100000),uint128(10000),uint128(10000),recipient,context);
        p[1] = abi.encode(key.currency0,key.currency1);
        return abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION),uint8(Actions.SETTLE_PAIR)),p);
    }

    function _run(address caller,bytes memory data,uint256 deadline) private {
        vmLP.prank(caller); positions.modifyLiquidities(data,deadline);
    }

    function _hookSnapshot(BellHook hook) private view returns(bytes32) {
        return keccak256(abi.encode(hook.state(),hook.buckets(),hook.episodeGross(hook.state().closureNonce),
            hook.seedPrincipal(),hook.config(),factory.nonces(address(this))));
    }

    function _snapshot(BellHook hook) private view returns(bytes32) {
        address[5] memory accounts = [RECIPIENT,address(this),address(manager),address(positions),address(factory)];
        uint256[10] memory balances;
        for(uint256 i; i < 5; ++i) { balances[i*2] = token0.balanceOf(accounts[i]); balances[i*2+1] = token1.balanceOf(accounts[i]); }
        return keccak256(abi.encode(_hookSnapshot(hook),balances,positions.getPositionLiquidity(1),positions.ownerOf(1),positions.nextTokenId()));
    }

    function _fail(BellHook hook,address caller,bytes memory data,uint256 deadline) private {
        bytes32 beforeState = _snapshot(hook);
        vmLP.prank(caller);
        (bool ok,) = address(positions).call(abi.encodeCall(positions.modifyLiquidities,(data,deadline)));
        require(!ok,"unauthorized/invalid action succeeded");
        require(_snapshot(hook) == beforeState,"failed action was not atomic");
    }

    function _fund(address user) private {
        token0.mint(user,1e6); token1.mint(user,1e6);
        vmLP.prank(user); token0.approve(address(permit2),1e6);
        vmLP.prank(user); token1.approve(address(permit2),1e6);
        vmLP.prank(user); permit2.approve(address(token0),address(positions),1e6,uint48(request.deadline));
        vmLP.prank(user); permit2.approve(address(token1),address(positions),1e6,uint48(request.deadline));
    }
}
