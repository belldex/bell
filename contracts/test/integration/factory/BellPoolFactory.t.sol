// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPoolFactory} from "../../../src/BellPoolFactory.sol";
import {TreasuryAdapter} from "../../../src/TreasuryAdapter.sol";
import {BellHookDeployer} from "../../../src/BellHookDeployer.sol";
import {BellHook} from "../../../src/BellHook.sol";
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {ModePolicy} from "../../../src/libraries/ModePolicy.sol";
import {CreateRequest, CreateResult, PoolConfig, AssetDescriptor, HealthView, CalendarLeaf, Lifecycle, Mode, PolicyView, SourceWire, SourceSample} from "../../../src/types/ProtocolTypes.sol";
import {AssetRegistry} from "../../../src/registries/AssetRegistry.sol";
import {SessionRegistry} from "../../../src/registries/SessionRegistry.sol";
import {SourceConfigHash} from "../../../src/libraries/SourceConfigHash.sol";
import {MockSessionAdapter, MockSessionQuoteSource} from "../../SessionRegistry.t.sol";
import {MockAssetRegistry, MockCalendarRegistry, MockSessionRegistry, MockSafetyController} from "../../unit/hook/BellHookLifecycle.t.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Actions} from "../../../lib/v4-periphery/src/libraries/Actions.sol";
import {PositionManager} from "../../../lib/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "../../../lib/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "../../../lib/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface VmFactory {
    function warp(uint256) external;
    function getNonce(address) external view returns (uint64);
    function computeCreateAddress(address,uint256) external pure returns (address);
    function mockCall(address,bytes calldata,bytes calldata) external;
    function mockCallRevert(address,bytes calldata,bytes calldata) external;
    function clearMockedCalls() external;
    function prank(address) external;
    function chainId(uint256) external;
    function etch(address,bytes calldata) external;
}

contract FactoryToken is ERC20 {
    address private reentryTarget;
    bytes private reentryData;
    FactoryToken private donationToken;
    address private donationRecipient;
    bool public oraclePaused;
    constructor() ERC20("Local fixture", "LOCAL") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
    function uiMultiplier() external pure returns(uint256) { return 1e18; }
    function newUIMultiplier() external pure returns(uint256) { return 1e18; }
    function effectiveAt() external pure returns(uint256) { return 0; }
    function setOraclePaused(bool value) external { oraclePaused = value; }
    function setReentry(address target,bytes calldata data) external { reentryTarget = target; reentryData = data; }
    function setDonation(FactoryToken token,address recipient) external { donationToken = token; donationRecipient = recipient; }
    function transferFrom(address from,address to,uint256 amount) public override returns(bool) {
        if (reentryTarget != address(0)) {
            (bool ok,bytes memory reason) = reentryTarget.call(reentryData);
            require(!ok && bytes4(reason) == BellPoolFactory.ReentrantRequest.selector,"request reentry admitted");
        }
        if (address(donationToken) != address(0)) donationToken.mint(donationRecipient, 123);
        return super.transferFrom(from,to,amount);
    }
}

contract FactoryAdmission is MockAssetRegistry {
    mapping(address => bytes32) public descriptorIdForToken;
    function admit(address token, bytes32 id) external { descriptorIdForToken[token] = id; }
}

contract FactoryRegistrySafety is MockSafetyController {
    address public governance = msg.sender;
    address public guardian = address(0xA11CE);
}

// Permit2's pinned implementation is solc 0.8.17, unlike this 0.8.26 suite. This deliberately
// narrow settlement double is NOT evidence of real Permit2 integration.
contract FactoryPermit2 {
    mapping(address => mapping(address => mapping(address => uint160))) private amounts;
    bool public fail;
    MockSessionRegistry public failHealth;
    function setFail(bool value) external { fail = value; }
    function setFailHealth(MockSessionRegistry value) external { failHealth = value; }
    function approve(address token,address spender,uint160 amount,uint48) external { amounts[msg.sender][token][spender] = amount; }
    function allowance(address owner,address token,address spender) external view returns(uint160,uint48,uint48) {
        return (amounts[owner][token][spender],type(uint48).max,0);
    }
    function transferFrom(address from,address to,uint160 amount,address token) external {
        require(!fail,"settlement failure");
        amounts[from][token][msg.sender] -= amount;
        require(IERC20(token).transferFrom(from,to,amount),"transfer");
        if (address(failHealth) != address(0)) failHealth.setRevertReads(true);
    }
}

/// @dev Real pinned core/PositionManager, synthetic Permit2/admission/calendar/health, no network.
contract BellPoolFactoryTest {
    VmFactory private constant vm = VmFactory(address(uint160(uint256(keccak256("hevm cheat code")))));
    BellPoolFactory internal factory;
    BellHookDeployer private deployer;
    PoolManager internal manager;
    PositionManager internal positions;
    FactoryPermit2 internal permit2;
    FactoryToken internal token0;
    FactoryToken internal token1;
    FactoryToken private usdg;
    FactoryAdmission internal assets;
    MockSessionRegistry internal sessions;
    CreateRequest internal request;
    AssetRegistry private realAssets;
    SessionRegistry private realSessions;
    MockSessionQuoteSource private realDirect;
    FactoryRegistrySafety private realSafety;
    FactoryToken private stockToken;
    bytes32 private stockId;
    bytes32 private quoteId;
    address internal constant RECIPIENT = address(0xBEEF);
    address internal constant SERVICE = address(0xFEE);

    /// @dev Shared policy oracle. Created before any address prediction so CREATE nonces stay stable.
    BellPolicyOracle internal oracle_hoisted;

    function setUp() external {
        vm.warp(10000);
        manager = new PoolManager(address(this));
        permit2 = new FactoryPermit2();
        positions = new PositionManager(manager, IAllowanceTransfer(address(permit2)), 100000, IPositionDescriptor(address(0)), IWETH9(address(0)));
        FactoryToken a = new FactoryToken(); FactoryToken b = new FactoryToken();
        (token0, token1) = address(a) < address(b) ? (a,b) : (b,a);
        usdg = new FactoryToken();
        assets = new FactoryAdmission();
        sessions = new MockSessionRegistry();
        MockCalendarRegistry calendar = new MockCalendarRegistry();
        MockSafetyController safety = new MockSafetyController();
        oracle_hoisted = new BellPolicyOracle();
        BellModeEvaluator modeEvaluator = new BellModeEvaluator();
        address future = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        deployer = new BellHookDeployer(future, address(sessions), keccak256(type(BellHook).creationCode), address(oracle_hoisted), address(modeEvaluator));
        PoolConfig memory c = PoolConfig({token0:address(token0), token1:address(token1), asset0:bytes32(uint256(1)), asset1:bytes32(uint256(2)),
            poolManager:address(manager),positionManager:address(positions),factory:future,assetRegistry:address(assets),calendarRegistry:address(calendar),
            safetyController:address(safety),treasuryAdapter:address(0),poolClass:1,liquidityMode:0,referenceMode:0,tickSpacing:60,
            tradeCap:[uint128(10),uint128(10)],windowCap:[uint128(100),uint128(100)],closureCap:[uint128(1),uint128(1)],policyId:keccak256("candidate"),
            referenceAdapter0:address(0),referenceAdapter1:address(0)});
        factory = new BellPoolFactory(c, deployer, address(usdg), SERVICE);
        require(address(factory) == future, "factory prediction");
        _admit(c.asset0, address(token0), true);
        _admit(c.asset1, address(token1), false);
        calendar.setLeaf(CalendarLeaf(c.asset0, 2026, 0, 9000, 20000, 2, keccak256("fixture")));
        request = CreateRequest(c, bytes32(0), 0, 10100, RECIPIENT, uint160(1 << 96), -120, 120, 1000000,
            [uint128(10000),uint128(10000)], 49e6);
        request.salt = _mine(request);
        token0.mint(address(this), 1e9); token1.mint(address(this), 1e9); usdg.mint(address(this), 1e9);
        token0.approve(address(factory), type(uint256).max); token1.approve(address(factory), type(uint256).max);
        usdg.approve(address(factory), type(uint256).max);
    }

    function testAtomicExplicitMintReceiptPrincipalFeeAndNoForeignSweep() external {
        token0.mint(address(factory), 777); token1.mint(address(factory), 888);
        uint256 before0 = token0.balanceOf(address(this));
        uint256 before1 = token1.balanceOf(address(this));
        (address predicted,bytes32 poolId,) = factory.predict(request);
        CreateResult memory r = factory.createAndSeed(request);
        require(r.hook == predicted && r.poolId == poolId && r.tokenId == 1 && r.liquidity == request.liquidity, "result");
        require(positions.ownerOf(r.tokenId) == RECIPIENT && positions.getPositionLiquidity(r.tokenId) == request.liquidity, "receipt");
        require(r.seedPrincipal[0] == before0-token0.balanceOf(address(this)) && r.seedPrincipal[0] > 0, "principal debit");
        require(r.seedPrincipal[1] == before1-token1.balanceOf(address(this)) && r.seedPrincipal[1] > 0, "principal1 debit");
        require(token0.balanceOf(address(manager)) == r.seedPrincipal[0] && token1.balanceOf(address(manager)) == r.seedPrincipal[1],"core settlement");
        require(r.positionKey == keccak256(abi.encodePacked(address(positions),request.tickLower,request.tickUpper,bytes32(r.tokenId))),"position key");
        require(token0.balanceOf(address(factory)) == 777 && token1.balanceOf(address(factory)) == 888, "foreign balances");
        require(usdg.balanceOf(SERVICE) == 49e6 && factory.nonces(address(this)) == 1, "fee/nonce");
        require(token0.allowance(address(factory),address(permit2)) == 0, "erc20 allowance");
        (uint160 allowed,,) = permit2.allowance(address(factory),address(token0),address(positions));
        require(allowed == 0, "permit2 allowance");
        require(BellHook(r.hook).state().lifecycle == uint8(Lifecycle.LIVE) && BellHook(r.hook).getPolicy().mode != uint8(Mode.RECOVERING), "swap gate");
        require(bytes4(_mustFail(request)) == BellPoolFactory.InvalidRequest.selector,"nonce replay validation");
    }

    function testInitializationFailureRollsBack() external {
        (address h,,) = factory.predict(request);
        PoolKey memory key = PoolKey(Currency.wrap(address(token0)),Currency.wrap(address(token1)),LPFeeLibrary.DYNAMIC_FEE_FLAG,60,IHooks(h));
        bytes memory injected = abi.encodeWithSignature("Error(string)","initialization failure");
        vm.mockCallRevert(address(manager),abi.encodeCall(IPoolManager.initialize,(key,request.sqrtPriceX96)),injected);
        require(keccak256(_rollback(request)) == keccak256(injected),"not initialize failure");
    }
    function testExplicitLiquidityAmountMaximumFailureRollsBack() external { request.amountMax[0] = 1; _rollback(request); }
    function testSecondCurrencyAmountMaximumFailureRollsBack() external { request.amountMax[1] = 1; _rollback(request); }
    function testSeedPrincipalCapsCheckedAtActivation() external {
        request.liquidity = 100;
        bytes memory reason = _rollback(request);
        require(bytes4(reason) == bytes4(keccak256("BadSeed()")),"seed cap not checked");
    }
    function testSpecialRecipientsCannotBeRemappedByPositionManager() external {
        request.recipient = address(1); _rollback(request);
        request.recipient = address(2); _rollback(request);
        request.recipient = address(factory); _rollback(request);
    }
    function testSettlementFailureRollsBack() external {
        permit2.setFail(true); _rollback(request);
    }
    function testActivationFailureRollsBack() external {
        permit2.setFailHealth(sessions);
        bytes memory reason = _rollback(request);
        require(bytes4(reason) == bytes4(keccak256("BadSeed()")), "not activation failure");
    }
    function testFeeTransferFailureRollsBackActivationAndMint() external {
        usdg.approve(address(factory),0); _rollback(request);
    }
    function testTokenCallbackCannotReenterRequest() external {
        token0.setReentry(address(factory),abi.encodeCall(factory.createAndSeed,(request)));
        CreateResult memory r = factory.createAndSeed(request);
        require(r.tokenId == 1 && factory.nonces(address(this)) == 1 && positions.nextTokenId() == 2,"reentry state");
    }
    function testFundingCannotUseForeignBalanceOrNominalTaxedTransfer() external {
        token0.mint(address(factory), 10000);
        vm.mockCall(address(token0),abi.encodeCall(IERC20.transferFrom,(address(this),address(factory),request.amountMax[0])),abi.encode(true));
        bytes memory reason = _mustFail(request);
        require(bytes4(reason) == BellPoolFactory.BalanceMismatch.selector && token0.balanceOf(address(factory)) == 10000,"foreign principal used");
    }
    function testRefundFailureRollsBackEverything() external {
        vm.mockCall(address(token0),abi.encodeWithSelector(IERC20.transfer.selector,address(this)),abi.encode(true));
        bytes memory reason = _rollback(request);
        require(bytes4(reason) == BellPoolFactory.BalanceMismatch.selector,"refund debit unchecked");
    }
    function testFeeCallbackDonationCannotBecomeAnUnboundedRefund() external {
        usdg.setDonation(token0,address(factory));
        bytes memory reason = _rollback(request);
        require(bytes4(reason) == BellPoolFactory.BalanceMismatch.selector,"foreign callback donation refunded");
    }
    function testFeeCurrencyCanOverlapLpWithoutUsingPrincipalOrForeignFunds() external {
        PoolConfig memory c = request.config;
        oracle_hoisted = new BellPolicyOracle();
        BellModeEvaluator modeEvaluator = new BellModeEvaluator();
        address future = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        deployer = new BellHookDeployer(future,address(sessions),keccak256(type(BellHook).creationCode),address(oracle_hoisted),address(modeEvaluator));
        c.factory = future;
        factory = new BellPoolFactory(c,deployer,address(token0),SERVICE);
        request.config = c; request.salt = _mine(request);
        token0.approve(address(factory),type(uint256).max); token1.approve(address(factory),type(uint256).max);
        token0.mint(address(factory),777);
        uint256 start = token0.balanceOf(address(this));
        CreateResult memory r = factory.createAndSeed(request);
        require(start - token0.balanceOf(address(this)) == r.seedPrincipal[0] + 49e6,"fee/principal conflated");
        require(token0.balanceOf(SERVICE) == 49e6 && token0.balanceOf(address(factory)) == 777,"fee custody/sweep");
    }
    function testMaxServiceFeeRejectedBeforeFunding() external { request.maxServiceFee--; _rollback(request); }
    function testPriceGuardedMissingAdaptersRejectedBeforeFunding() external {
        PoolConfig memory c = request.config;
        oracle_hoisted = new BellPolicyOracle();
        BellModeEvaluator modeEvaluator = new BellModeEvaluator();
        address future = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        deployer = new BellHookDeployer(future,address(sessions),keccak256(type(BellHook).creationCode),address(oracle_hoisted),address(modeEvaluator));
        c.factory = future; c.poolClass = 0;
        factory = new BellPoolFactory(c,deployer,address(usdg),SERVICE);
        request.config = c; request.tickLower = -6000; request.tickUpper = 6000;
        request.sqrtPriceX96 = TickMath.getSqrtPriceAtTick(3000);
        // PRICE_GUARDED without both reference adapters is a malformed profile, not a priced pool.
        require(bytes4(_rollback(request)) == BellPoolFactory.InvalidConfiguration.selector,"priced initial guard bypass");
    }
    function testCreatorServiceRecipientRejectedBeforeFunding() external {
        vm.prank(SERVICE);
        (bool ok,bytes memory reason) = address(factory).call(abi.encodeCall(factory.createAndSeed,(request)));
        require(!ok && bytes4(reason) == BellPoolFactory.InvalidRequest.selector,"self fee not rejected before funding");
        require(factory.nonces(SERVICE) == 0 && positions.nextTokenId() == 1,"self fee consumed state");
    }
    function testRealRegistriesOraclelessSessionOnlyToken1CanSeed() external {
        _useRealRegistries(true);
        _assertOraclelessSeed();
    }
    function testRealRegistriesOraclelessSessionOnlyToken0CanSeed() external {
        _useRealRegistries(false);
        _assertOraclelessSeed();
    }
    function testRealRegistriesOraclelessDoesNotBypassStockHealth() external {
        _useRealRegistries(true);
        stockToken.setOraclePaused(true);
        realSessions.refreshHealth(stockId);
        require(!realSessions.health(stockId).ready,"stock pause not reflected");
        require(bytes4(_rollback(request)) == BellPoolFactory.InvalidConfiguration.selector,"stock health bypass");
    }
    function testRealRegistriesOraclelessDoesNotBypassQuotePause() external {
        _useRealRegistries(true);
        realSafety.setPause(ModePolicy.targetId(2,address(token1)),true,1);
        require(bytes4(_rollback(request)) == bytes4(keccak256("BadSeed()")),"quote pause bypass");
    }
    function testRealRegistriesOraclelessDoesNotBypassQuoteTransferRisk() external {
        _useRealRegistries(true);
        vm.mockCall(address(token1),abi.encodeCall(IERC20.transferFrom,(address(this),address(factory),request.amountMax[1])),abi.encode(true));
        require(bytes4(_rollback(request)) == BellPoolFactory.BalanceMismatch.selector,"quote actual credits bypassed");
    }
    function testRealRegistriesOraclelessDoesNotBypassQuoteFingerprint() external {
        _useRealRegistries(true);
        vm.etch(address(token1),hex"00");
        require(bytes4(_mustFail(request)) == BellPoolFactory.InvalidConfiguration.selector,"quote identity bypassed");
        require(factory.nonces(address(this)) == 0 && positions.nextTokenId() == 1,"identity failure consumed state");
    }
    function testRealRegistriesOraclelessDoesNotBypassStockWarmupAfterGap() external {
        _useRealRegistries(true);
        vm.warp(block.timestamp + 61); _refreshRealStock();
        request.deadline = uint64(block.timestamp + 100);
        require(realSessions.health(stockId).healthySince == block.timestamp,"health gap not reset");
        CreateResult memory result = factory.createAndSeed(request);
        PolicyView memory policy = BellHook(result.hook).getPolicy();
        require(BellHook(result.hook).state().lifecycle == uint8(Lifecycle.LIVE), "session-only pool did not activate");
        require(policy.canSwap && policy.flags & 4 != 0, "session-only freshness gate remained active");
    }
    function testSessionOnlyRequiresExactlyOneAdmittedStock() external {
        AssetDescriptor memory d0 = assets.descriptor(request.config.asset0);
        AssetDescriptor memory d1 = assets.descriptor(request.config.asset1);
        d0.isStock = false; assets.setDescriptor(d0);
        require(bytes4(_rollback(request)) == BellPoolFactory.InvalidConfiguration.selector,"no-stock pool admitted");
        d0.isStock = true; d1.isStock = true; assets.setDescriptor(d0); assets.setDescriptor(d1);
        require(bytes4(_rollback(request)) == BellPoolFactory.InvalidConfiguration.selector,"stock-stock mislabeled session-only");
    }
    function testRealRegistriesRejectOraclelessMissingRiskEvidence() external {
        _useRealRegistries(true);
        FactoryToken candidate = new FactoryToken();
        AssetDescriptor memory d = realAssets.descriptor(quoteId);
        d.id = bytes32(0); d.token = address(candidate); d.expectedCodeHash = address(candidate).codehash;
        d.evidenceHash = bytes32(0);
        (bool ok,) = address(realAssets).call(abi.encodeCall(realAssets.queueAsset,(d,bytes(""))));
        require(!ok,"risk evidence bypass");
        d.evidenceHash = bytes32(uint256(1)); d.isStock = true;
        (ok,) = address(realAssets).call(abi.encodeCall(realAssets.queueAsset,(d,bytes(""))));
        require(!ok,"stock oracle requirement bypass");
    }
    function _assertOraclelessSeed() private {
        realSessions.refreshHealth(quoteId);
        require(!realSessions.health(quoteId).ready && realSessions.health(quoteId).validUntil == 0,"invented quote oracle health");
        CreateResult memory r = factory.createAndSeed(request);
        require(BellHook(r.hook).state().lifecycle == uint8(Lifecycle.LIVE),"oracleless seed not activated");
        require(BellHook(r.hook).getPolicy().mode != uint8(Mode.RECOVERING),"M05-05 gate");
        _assertAllowancesCleared();
    }

    function _useRealRegistries(bool stockFirst) private {
        realSafety = new FactoryRegistrySafety();
        realAssets = new AssetRegistry(address(realSafety));
        stockToken = stockFirst ? token0 : token1;
        (AssetDescriptor memory stock,bytes memory config) = _realStockDescriptor();
        bytes32 stockOp = realAssets.queueAsset(stock,config);
        FactoryToken quote = stockFirst ? token1 : token0;
        AssetDescriptor memory q = AssetDescriptor(bytes32(0),address(quote),false,6,0,address(0),address(0),address(0),address(0),address(0),
            address(quote).codehash,bytes32(uint256(1)),bytes32(uint256(2)));
        bytes32 quoteOp = realAssets.queueAsset(q,bytes(""));
        vm.warp(block.timestamp + 48 hours);
        stockId = realAssets.activateAsset(stockOp); quoteId = realAssets.activateAsset(quoteOp);
        MockCalendarRegistry calendar = new MockCalendarRegistry();
        calendar.setLeaf(CalendarLeaf(stockId,2026,0,uint64(block.timestamp - 1),uint64(block.timestamp + 1000),2,bytes32(uint256(1))));
        realSessions = new SessionRegistry(address(realAssets),address(calendar));
        _refreshRealStock();
        vm.warp(block.timestamp + 30); _refreshRealStock();
        vm.warp(block.timestamp + 30); _refreshRealStock();
        require(realSessions.health(stockId).ready,"real stock fixture unhealthy");
        PoolConfig memory c = request.config;
        c.asset0 = stockFirst ? stockId : quoteId; c.asset1 = stockFirst ? quoteId : stockId;
        c.assetRegistry = address(realAssets); c.calendarRegistry = address(calendar); c.safetyController = address(realSafety);
        oracle_hoisted = new BellPolicyOracle();
        BellModeEvaluator modeEvaluator = new BellModeEvaluator();
        address future = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        deployer = new BellHookDeployer(future,address(realSessions),keccak256(type(BellHook).creationCode),address(oracle_hoisted),address(modeEvaluator));
        c.factory = future; factory = new BellPoolFactory(c,deployer,address(usdg),SERVICE);
        request.config = c; request.deadline = uint64(block.timestamp + 100); request.salt = _mine(request);
        token0.approve(address(factory),type(uint256).max); token1.approve(address(factory),type(uint256).max); usdg.approve(address(factory),type(uint256).max);
    }
    function _realStockDescriptor() private returns(AssetDescriptor memory d,bytes memory encoded) {
        MockSessionAdapter stream = new MockSessionAdapter();
        realDirect = new MockSessionQuoteSource(_sampleNow(bytes32(0),0,bytes32(0)));
        SourceWire[] memory wires = new SourceWire[](2);
        bytes32 canonical = keccak256(abi.encode(block.chainid,address(stockToken)));
        wires[0] = SourceWire(1,0,address(realDirect),bytes32(0),0,8,2,60,address(realDirect).codehash,address(realDirect),canonical);
        wires[1] = SourceWire(3,1,address(stream),bytes32(uint256(1)),11,8,1,0,address(stream).codehash,address(stream),canonical);
        realDirect.setConfigHash(SourceConfigHash.hash(wires[0])); stream.setConfigHash(SourceConfigHash.hash(wires[1]));
        d = AssetDescriptor(bytes32(0),address(stockToken),true,6,4,address(realDirect),address(stream),address(0),address(0),address(0),
            address(stockToken).codehash,bytes32(uint256(1)),bytes32(uint256(2)));
        encoded = abi.encode(wires);
    }
    function _refreshRealStock() private {
        realDirect.setSample(_sampleNow(bytes32(0),0,bytes32(0)));
        bytes[] memory reports = new bytes[](1); reports[0] = abi.encode(_sampleNow(stockId,2,bytes32(uint256(1))));
        realSessions.submitReports(stockId,reports); realSessions.refreshHealth(stockId);
    }
    function _sampleNow(bytes32 id,uint8 phase,bytes32 feed) private view returns(SourceSample memory) {
        return SourceSample(id,feed,phase,100e18,uint64(block.timestamp),uint64(block.timestamp),uint64(block.timestamp - 1),
            uint64(block.timestamp + 120),uint64(block.timestamp + 120),keccak256(abi.encode(block.timestamp,phase)));
    }
    function testSeedPriceMustBeStrictlyInsideTickRangeBeforeDeployment() external {
        request.sqrtPriceX96 = TickMath.getSqrtPriceAtTick(request.tickLower);
        bytes memory reason = _rollback(request);
        require(bytes4(reason) == BellPoolFactory.InvalidRequest.selector,"range not validated");
        request.sqrtPriceX96 = TickMath.getSqrtPriceAtTick(request.tickUpper);
        reason = _rollback(request);
        require(bytes4(reason) == BellPoolFactory.InvalidRequest.selector,"upper range not validated");
    }
    function testMissingFeeTokenFailsClosedNotFreePilot() external {
        PoolConfig memory c = request.config;
        oracle_hoisted = new BellPolicyOracle();
        BellModeEvaluator modeEvaluator = new BellModeEvaluator();
        address future = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        BellHookDeployer d = new BellHookDeployer(future,address(sessions),keccak256(type(BellHook).creationCode),address(oracle_hoisted),address(modeEvaluator));
        c.factory = future;
        BellPoolFactory unbound = new BellPoolFactory(c,d,address(0),SERVICE);
        CreateRequest memory r = request; r.config = c;
        (bool ok,bytes memory reason) = address(unbound).call(abi.encodeCall(unbound.createAndSeed,(r)));
        require(!ok && bytes4(reason) == BellPoolFactory.FeeTokenNotBound.selector,"unbound fee opened");
    }
    function testNoHookDataSwapOrSecondMintBypassAfterActivation() external {
        (,,bytes32 requestHash) = factory.predict(request);
        CreateResult memory r = factory.createAndSeed(request);
        PoolKey memory key = BellHook(r.hook).poolKey();
        vm.prank(address(manager));
        (bool ok,) = r.hook.call(abi.encodeCall(IHooks.beforeSwap,(address(this),key,SwapParams(true,-1,1),abi.encode(address(factory),"bypass"))));
        require(!ok,"hookData swap bypass");
        bytes[] memory params = new bytes[](1);
        params[0] = abi.encode(key,request.tickLower,request.tickUpper,uint256(request.liquidity),request.amountMax[0],request.amountMax[1],RECIPIENT,abi.encode(address(factory)));
        (ok,) = address(positions).call(abi.encodeCall(positions.modifyLiquidities,(abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION)),params),request.deadline)));
        require(!ok && positions.nextTokenId() == 2,"second seed bypass");
        vm.prank(address(factory));
        (ok,) = r.hook.call(abi.encodeCall(BellHook.activatePool,(requestHash,r.tokenId)));
        require(!ok,"second activation");
    }
    function testReceiptOwnerFailureRollsBack() external {
        vm.mockCall(address(positions), abi.encodeWithSignature("ownerOf(uint256)",1), abi.encode(address(this))); _rollback(request);
    }
    function testReceiptLiquidityFailureRollsBack() external {
        vm.mockCall(address(positions), abi.encodeWithSignature("getPositionLiquidity(uint256)",1), abi.encode(uint128(99))); _rollback(request);
    }
    function testReceiptPoolFailureRollsBack() external { _badReceipt(true); }
    function testReceiptTicksFailureRollsBack() external { _badReceipt(false); }
    function testExpiredAndWrongNonceFailBeforeFunding() external {
        request.deadline = 9999;
        require(bytes4(_mustFail(request)) == BellPoolFactory.InvalidRequest.selector,"deadline validation");
        request.deadline = 10100; request.nonce = 1;
        require(bytes4(_mustFail(request)) == BellPoolFactory.InvalidRequest.selector,"nonce validation");
        require(factory.nonces(address(this)) == 0 && positions.nextTokenId() == 1, "consumed");
    }
    function testTreasuryAndChangedRiskDependencyRejected() external {
        request.config.liquidityMode = 1;
        require(bytes4(_mustFail(request)) == BellPoolFactory.UnsupportedLiquidityMode.selector,"treasury gate");
        request.config.liquidityMode = 0; request.config.tradeCap[0] = 11;
        require(bytes4(_mustFail(request)) == BellPoolFactory.InvalidConfiguration.selector,"risk profile gate");
        request.config.tradeCap[0] = 10; request.config.positionManager = address(manager);
        require(bytes4(_mustFail(request)) == BellPoolFactory.InvalidConfiguration.selector,"dependency gate");
    }
    function testPublicPositionOwnerCanExitInKindWhenSessionBackendIsUnavailable() external {
        CreateResult memory created = factory.createAndSeed(request);
        uint256 before0 = token0.balanceOf(RECIPIENT);
        uint256 before1 = token1.balanceOf(RECIPIENT);
        sessions.setRevertReads(true);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(created.tokenId, uint256(request.liquidity), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(address(token0)), Currency.wrap(address(token1)), RECIPIENT);
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        vm.prank(RECIPIENT);
        positions.modifyLiquidities(abi.encode(actions, params), request.deadline);
        require(positions.ownerOf(created.tokenId) == RECIPIENT, "position left owner custody");
        require(positions.getPositionLiquidity(created.tokenId) == 0, "position not removed");
        require(token0.balanceOf(RECIPIENT) > before0 && token1.balanceOf(RECIPIENT) > before1, "exit not in-kind");
    }

    function testPublicPositionOwnerCanExitInKindDuringManualPoolPause() external {
        CreateResult memory created = factory.createAndSeed(request);
        uint256 before0 = token0.balanceOf(RECIPIENT);
        uint256 before1 = token1.balanceOf(RECIPIENT);
        MockSafetyController(request.config.safetyController).setPause(ModePolicy.targetId(1, created.hook), true, 1);
        PolicyView memory policy = BellHook(created.hook).refreshState();
        require(!policy.canSwap, "manual pause failed to stop swaps");
        _removePublicPosition(created.tokenId, RECIPIENT, request.liquidity, request.deadline);
        require(positions.getPositionLiquidity(created.tokenId) == 0, "paused exit not removed");
        require(token0.balanceOf(RECIPIENT) > before0 && token1.balanceOf(RECIPIENT) > before1, "paused exit not in-kind");
    }

    function testPublicPositionOwnerCanCollectThroughPositionManagerWhenSessionBackendIsUnavailable() external {
        CreateResult memory created = factory.createAndSeed(request);
        uint128[2] memory seedBefore = BellHook(created.hook).seedPrincipal();
        sessions.setRevertReads(true);
        bytes[] memory params = new bytes[](2);
        // Pinned PositionManager uses an explicit zero-liquidity increase to collect accrued fees.
        params[0] = abi.encode(created.tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(address(token0)), Currency.wrap(address(token1)), RECIPIENT);
        bytes memory actions = abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        vm.prank(RECIPIENT);
        positions.modifyLiquidities(abi.encode(actions, params), request.deadline);
        require(positions.ownerOf(created.tokenId) == RECIPIENT, "collect changed owner");
        require(positions.getPositionLiquidity(created.tokenId) == request.liquidity, "collect changed liquidity");
        uint128[2] memory seedAfter = BellHook(created.hook).seedPrincipal();
        require(seedAfter[0] == seedBefore[0] && seedAfter[1] == seedBefore[1], "collect changed captured seed");
    }

    function _removePublicPosition(uint256 tokenId, address recipient, uint128 liquidity, uint64 deadline) private {
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(liquidity), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(address(token0)), Currency.wrap(address(token1)), recipient);
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        vm.prank(recipient);
        positions.modifyLiquidities(abi.encode(actions, params), deadline);
    }

    function testPublicPositionOwnerCanIncreaseWithoutChangingSeedPrincipal() external {
        CreateResult memory created = factory.createAndSeed(request);
        BellHook hook = BellHook(created.hook);
        uint128[2] memory seedBefore = hook.seedPrincipal();
        token0.mint(RECIPIENT, 100_000);
        token1.mint(RECIPIENT, 100_000);
        vm.prank(RECIPIENT); token0.approve(address(permit2), 100_000);
        vm.prank(RECIPIENT); token1.approve(address(permit2), 100_000);
        vm.prank(RECIPIENT); permit2.approve(address(token0), address(positions), 100_000, uint48(request.deadline));
        vm.prank(RECIPIENT); permit2.approve(address(token1), address(positions), 100_000, uint48(request.deadline));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(created.tokenId, uint256(100_000), uint128(10_000), uint128(10_000), bytes(""));
        params[1] = abi.encode(Currency.wrap(address(token0)), Currency.wrap(address(token1)));
        bytes memory actions = abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY), uint8(Actions.SETTLE_PAIR));
        vm.prank(RECIPIENT);
        positions.modifyLiquidities(abi.encode(actions, params), request.deadline);
        require(positions.ownerOf(created.tokenId) == RECIPIENT, "position owner changed");
        require(positions.getPositionLiquidity(created.tokenId) == request.liquidity + 100_000, "increase not recorded");
        uint128[2] memory seedAfter = hook.seedPrincipal();
        require(seedAfter[0] == seedBefore[0] && seedAfter[1] == seedBefore[1], "add changed captured seed");
    }

    function testUnapprovedCallerCannotIncreaseOrRemoveAnotherUsersPosition() external {
        CreateResult memory created = factory.createAndSeed(request);
        bytes[] memory addParams = new bytes[](1);
        addParams[0] = abi.encode(created.tokenId, uint256(1), uint128(1), uint128(1), bytes(""));
        bytes memory addAction = abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY));
        vm.prank(address(0xCAFE));
        (bool addOk,) = address(positions).call(abi.encodeCall(
            positions.modifyLiquidities, (abi.encode(addAction, addParams), request.deadline)
        ));
        require(!addOk, "unapproved increase accepted");

        bytes[] memory removeParams = new bytes[](1);
        removeParams[0] = abi.encode(created.tokenId, uint256(request.liquidity), uint128(0), uint128(0), bytes(""));
        bytes memory removeAction = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY));
        vm.prank(address(0xCAFE));
        (bool removeOk,) = address(positions).call(abi.encodeCall(
            positions.modifyLiquidities, (abi.encode(removeAction, removeParams), request.deadline)
        ));
        require(!removeOk, "unapproved removal accepted");
        require(positions.ownerOf(created.tokenId) == RECIPIENT
            && positions.getPositionLiquidity(created.tokenId) == request.liquidity, "unauthorized state changed");
    }
    function testRequestHashBindsEveryRequestAndCallerNamespace() external {
        (address a,,bytes32 h) = factory.predict(request);
        CreateRequest memory r = request;
        r.amountMax[0]++; _differentHash(r,h); r = request;
        r.amountMax[1]++; _differentHash(r,h); r = request;
        r.maxServiceFee++; _differentHash(r,h); r = request;
        r.recipient = address(0xCAFE); _differentHash(r,h); r = request;
        r.salt = bytes32(uint256(999)); _differentHash(r,h); r = request;
        r.nonce++; _differentHash(r,h); r = request;
        r.deadline++; _differentHash(r,h); r = request;
        r.sqrtPriceX96++; _differentHash(r,h); r = request;
        r.tickLower -= 60; _differentHash(r,h); r = request;
        r.tickUpper += 60; _differentHash(r,h); r = request;
        r.liquidity++; _differentHash(r,h); r = request;
        r.config.policyId = bytes32(uint256(999)); _differentHash(r,h);
        vm.prank(RECIPIENT);
        (address other,,bytes32 changed) = factory.predict(request);
        require(other != a && changed != h,"caller namespace unbound");
        uint256 chain = block.chainid; vm.chainId(chain + 1);
        (other,,changed) = factory.predict(request);
        require(other != a && changed != h,"chain namespace unbound"); vm.chainId(chain);
        require(a != address(0), "prediction");
    }

    function _differentHash(CreateRequest memory r,bytes32 original) private view {
        (,,bytes32 h) = factory.predict(r); require(h != original,"request field unbound");
    }

    function _badReceipt(bool pool) private {
        (address h,,) = factory.predict(request);
        PoolKey memory key = PoolKey(Currency.wrap(address(token0)),Currency.wrap(address(token1)),LPFeeLibrary.DYNAMIC_FEE_FLAG,60,IHooks(h));
        uint256 info = (uint256(uint24(request.tickLower)) << 8) | (uint256(uint24(request.tickUpper)) << 32);
        if (pool) key.tickSpacing = 10; else info = 0;
        vm.mockCall(address(positions),abi.encodeWithSignature("getPoolAndPositionInfo(uint256)",1),abi.encode(key,info));
        _rollback(request);
    }
    function _rollback(CreateRequest memory r) private returns(bytes memory reason) {
        (address predicted,bytes32 id,) = factory.predict(r);
        uint256 b0 = token0.balanceOf(address(this)); uint256 b1 = token1.balanceOf(address(this));
        uint256 feePayer = usdg.balanceOf(address(this));
        uint256[4] memory balances = [token0.balanceOf(address(factory)),token1.balanceOf(address(factory)),
            token0.balanceOf(address(manager)),token1.balanceOf(address(manager))];
        reason = _mustFail(r);
        require(predicted.code.length == 0 && factory.nonces(address(this)) == 0 && positions.nextTokenId() == 1, "deployment/nonce/NFT survived");
        require(token0.balanceOf(address(this)) == b0 && token1.balanceOf(address(this)) == b1 && usdg.balanceOf(SERVICE) == 0, "funds survived");
        require(usdg.balanceOf(address(this)) == feePayer,"fee payer debit survived");
        require(token0.balanceOf(address(factory)) == balances[0] && token1.balanceOf(address(factory)) == balances[1],"factory balances survived");
        require(token0.balanceOf(address(manager)) == balances[2] && token1.balanceOf(address(manager)) == balances[3],"core balances survived");
        _assertAllowancesCleared();
        (uint160 sqrtPrice,,,) = StateLibrary.getSlot0(IPoolManager(address(manager)),PoolId.wrap(id));
        require(sqrtPrice == 0,"initialized pool survived");
    }
    function _assertAllowancesCleared() private view {
        require(token0.allowance(address(factory),address(permit2)) == 0 && token1.allowance(address(factory),address(permit2)) == 0,"ERC20 allowances survived");
        (uint160 a0,,) = permit2.allowance(address(factory),address(token0),address(positions));
        (uint160 a1,,) = permit2.allowance(address(factory),address(token1),address(positions));
        require(a0 == 0 && a1 == 0,"Permit2 allowances survived");
    }
    function _mustFail(CreateRequest memory r) private returns(bytes memory reason) {
        bool ok; (ok,reason) = address(factory).call(abi.encodeCall(factory.createAndSeed,(r))); require(!ok,"unexpected success");
    }
    function _mine(CreateRequest memory r) private view returns (bytes32) {
        PoolKey memory key = PoolKey(Currency.wrap(r.config.token0),Currency.wrap(r.config.token1),LPFeeLibrary.DYNAMIC_FEE_FLAG,60,IHooks(address(0)));
        bytes32 initHash = deployer.initCodeHash(r.config,key);
        // Reuse bounded preimages. Repeated abi.encode allocations made unlucky (but valid) salts
        // exhaust memory after a template-bytecode change, before exercising any production code.
        bytes memory namespace = abi.encode(block.chainid,address(factory),address(this),r.nonce,bytes32(0));
        bytes memory createPreimage = abi.encodePacked(bytes1(0xff),address(deployer),bytes32(0),initHash);
        for(uint256 i; i < 200000; ++i) {
            bytes32 digest;
            assembly ("memory-safe") {
                mstore(add(namespace,160),i)
                let salt := keccak256(add(namespace,32),160)
                mstore(add(createPreimage,53),salt)
                digest := keccak256(add(createPreimage,32),85)
            }
            address h = address(uint160(uint256(digest)));
            if(uint160(h) & 0x3fff == 0x2cc0) return bytes32(i);
        }
        revert("salt search");
    }
    function _admit(bytes32 id,address token,bool stock) private {
        assets.admit(token,id);
        assets.setDescriptor(AssetDescriptor(id,token,stock,6,4,address(0),address(0),address(0),address(0),address(0),token.codehash,bytes32(uint256(1)),bytes32(uint256(1))));
        sessions.setHealth(id, HealthView(true,0,9000,11000,9900,9950));
    }

    function _mineTreasurySalt(address deployerAddr, address factoryAddr, bytes32 initHash) private view returns (bytes32 foundSalt) {
        bytes memory ns = abi.encode(block.chainid, factoryAddr, address(this), uint64(0), bytes32(0));
        bytes memory cp = abi.encodePacked(bytes1(0xff), deployerAddr, bytes32(0), initHash);
        for (uint256 i; i < 200000; ++i) {
            bytes32 digest;
            assembly ("memory-safe") {
                mstore(add(ns, 160), i)
                let s := keccak256(add(ns, 32), 160)
                mstore(add(cp, 53), s)
                digest := keccak256(add(cp, 32), 85)
            }
            if (uint160(uint256(digest)) & 0x3fff == 0x2cc0) {
                return bytes32(i);
            }
        }
        revert("treasury salt search");
    }

    function testTreasuryOnlyFactoryCanCreateAndSeedPool() external {
        oracle_hoisted = new BellPolicyOracle();
        BellModeEvaluator modeEvaluator = new BellModeEvaluator();
        uint64 n0 = vm.getNonce(address(this));
        address predictedDeployer = vm.computeCreateAddress(address(this), n0);
        address predictedAdapter = vm.computeCreateAddress(address(this), n0 + 1);
        address predictedFactory = vm.computeCreateAddress(address(this), n0 + 2);

        PoolConfig memory tc = request.config;
        tc.factory = predictedFactory;
        tc.liquidityMode = 1; // TREASURY_ONLY
        tc.treasuryAdapter = predictedAdapter;
        tc.positionManager = address(manager);

        BellHookDeployer tDeployer = new BellHookDeployer(predictedFactory, address(sessions), keccak256(type(BellHook).creationCode), address(oracle_hoisted), address(modeEvaluator));
        bytes32 initHash = tDeployer.initCodeHash(tc, PoolKey(Currency.wrap(tc.token0), Currency.wrap(tc.token1), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(0))));
        bytes32 foundSalt = _mineTreasurySalt(predictedDeployer, predictedFactory, initHash);
        bytes32 create2Salt = keccak256(abi.encode(block.chainid, predictedFactory, address(this), uint64(0), foundSalt));
        address predictedHook = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), predictedDeployer, create2Salt, initHash)))));

        address TREASURY_ADDR = address(0xAAAA1);
        TreasuryAdapter tAdapter = new TreasuryAdapter(manager, predictedFactory, TREASURY_ADDR, RECIPIENT, predictedHook, Currency.wrap(tc.token0), Currency.wrap(tc.token1), 60);
        BellPoolFactory tFactory = new BellPoolFactory(tc, tDeployer, address(usdg), SERVICE);

        CreateRequest memory tReq = CreateRequest({
            config: tc,
            salt: foundSalt,
            nonce: 0,
            deadline: 10100,
            recipient: RECIPIENT,
            sqrtPriceX96: uint160(1 << 96),
            tickLower: -120,
            tickUpper: 120,
            liquidity: 1_000_000,
            amountMax: [uint128(100000), uint128(100000)],
            maxServiceFee: tFactory.serviceFee()
        });

        token0.mint(TREASURY_ADDR, 1e9);
        token1.mint(TREASURY_ADDR, 1e9);
        vm.prank(TREASURY_ADDR);
        token0.approve(address(tAdapter), type(uint256).max);
        vm.prank(TREASURY_ADDR);
        token1.approve(address(tAdapter), type(uint256).max);

        usdg.mint(address(this), tReq.maxServiceFee);
        usdg.approve(address(tFactory), tReq.maxServiceFee);

        CreateResult memory res = tFactory.createAndSeed(tReq);
        require(res.tokenId == 0, "treasury tokenId must be 0");
        require(res.positionKey != bytes32(0), "positionKey must be valid");
        require(res.seedPrincipal[0] > 0 && res.seedPrincipal[1] > 0, "principal recorded");
        require(BellHook(res.hook).state().lifecycle == uint8(Lifecycle.LIVE), "hook must be live");
        require(tAdapter.position(res.positionKey).active, "adapter position must be active");
    }
}
