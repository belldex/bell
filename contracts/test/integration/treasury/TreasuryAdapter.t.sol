// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TreasuryAdapter} from "../../../src/TreasuryAdapter.sol";
import {BellHookDeployer} from "../../../src/BellHookDeployer.sol";
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
import {BellHook} from "../../../src/BellHook.sol";
import {CreateRequest, PoolConfig, AssetDescriptor, HealthView, CalendarLeaf, Mode, PolicyView} from "../../../src/types/ProtocolTypes.sol";
import {MockSessionAdapter, MockSessionQuoteSource} from "../../SessionRegistry.t.sol";
import {MockAssetRegistry, MockCalendarRegistry, MockSessionRegistry, MockSafetyController} from "../../unit/hook/BellHookLifecycle.t.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface VmTreasury {
    function warp(uint256) external;
    function getNonce(address) external view returns (uint64);
    function computeCreateAddress(address, uint256) external pure returns (address);
    function prank(address) external;
    function label(address, string calldata) external;
}

contract TreasuryToken is ERC20 {
    bool public senderTax;
    address public receiverTaxRecipient;
    uint256 public receiverTaxAmount;
    constructor() ERC20("Treasury Fixture", "TTF") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setSenderTax(bool value) external { senderTax = value; }
    function setReceiverTax(address recipient_, uint256 amount_) external {
        receiverTaxRecipient = recipient_;
        receiverTaxAmount = amount_;
    }
    function transfer(address to, uint256 amount) public override returns (bool) {
        uint256 tax = to == receiverTaxRecipient ? receiverTaxAmount : 0;
        if (tax != 0) {
            require(amount > tax, "tax exceeds transfer");
            super.transfer(to, amount - tax);
            _burn(_msgSender(), tax);
        } else {
            super.transfer(to, amount);
        }
        if (senderTax) _burn(_msgSender(), 1);
        return true;
    }
}

/// @dev The seed authority. Only this contract may call adapter.seed, deploy the hook and
/// activate the pool — mirroring the PUBLIC factory's single-transaction ordering.
contract TreasurySeedFactory {
    BellHookDeployer public immutable deployer;
    TreasuryAdapter public immutable adapter;
    IPoolManager public immutable manager;
    bytes32 public immutable createSalt;

    constructor(BellHookDeployer d, TreasuryAdapter a, IPoolManager m, bytes32 salt_) {
        deployer = d;
        adapter = a;
        manager = m;
        createSalt = salt_;
    }

    function createAndSeedTreasury(CreateRequest calldata r)
        external returns (address hook, bytes32 requestHash, bytes32 positionKey)
    {
        PoolKey memory key = PoolKey(
            Currency.wrap(r.config.token0), Currency.wrap(r.config.token1),
            LPFeeLibrary.DYNAMIC_FEE_FLAG, r.config.tickSpacing, IHooks(address(0)));
        hook = address(deployer.deploy(r.config, key, createSalt));
        key.hooks = IHooks(hook);
        requestHash = keccak256(abi.encode(block.chainid, address(this), r.nonce, r.deadline, r.salt));
        BellHook(hook).beginSeed(requestHash, r.tickLower, r.tickUpper, r.salt, r.liquidity);
        manager.initialize(key, r.sqrtPriceX96);
        positionKey = adapter.seed(requestHash, r);
        BellHook(hook).activatePool(requestHash, 0);
    }
}

contract TreasuryAdmission is MockAssetRegistry {
    mapping(address => bytes32) public descriptorIdForToken;
    function admit(address token, bytes32 id) external { descriptorIdForToken[token] = id; }
}

contract TreasuryAdapterTest {
    VmTreasury private constant vm = VmTreasury(address(uint160(uint256(keccak256("hevm cheat code")))));

    TreasurySeedFactory internal seedFactory;
    TreasuryAdapter internal adapter;
    BellHookDeployer internal deployer;
    PoolManager internal manager;
    TreasuryToken internal token0;
    TreasuryToken internal token1;
    TreasuryAdmission internal assets;
    MockSessionRegistry internal sessions;
    MockCalendarRegistry internal calendar;
    MockSafetyController internal safety;
    address internal hook;
    bytes32 internal requestHash;
    bytes32 internal posKey;
    bytes32 internal createSalt;

    address internal constant TREASURY = address(0xA11CE);
    address internal constant RECIPIENT = address(0xBEEF);
    address internal constant STRANGER = address(0xCAFE);

    CreateRequest internal request;

    function setUp() external {
        BellPolicyOracle oracle_hoisted = new BellPolicyOracle();
        vm.warp(10000);
        manager = new PoolManager(address(this));
        TreasuryToken a = new TreasuryToken();
        TreasuryToken b = new TreasuryToken();
        (token0, token1) = address(a) < address(b) ? (a, b) : (b, a);
        assets = new TreasuryAdmission();
        sessions = new MockSessionRegistry();
        calendar = new MockCalendarRegistry();
        safety = new MockSafetyController();

        // Deployment order: deployer, adapter, seed factory. Predict all three addresses so the
        // adapter can be constructed against the predicted hook address (it has no code yet).
        uint64 n0 = vm.getNonce(address(this));
        address predictedDeployer = vm.computeCreateAddress(address(this), n0);
        address predictedAdapter = vm.computeCreateAddress(address(this), n0 + 1);
        address predictedFactory = vm.computeCreateAddress(address(this), n0 + 2);

        PoolConfig memory c = PoolConfig({
            token0: address(token0), token1: address(token1),
            asset0: bytes32(uint256(1)), asset1: bytes32(uint256(2)),
            poolManager: address(manager), positionManager: address(manager), factory: predictedFactory,
            assetRegistry: address(assets), calendarRegistry: address(calendar),
            safetyController: address(safety), treasuryAdapter: predictedAdapter,
            poolClass: 1, liquidityMode: 1, referenceMode: 0, tickSpacing: 60,
            tradeCap: [uint128(10), uint128(10)], windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)], policyId: keccak256("candidate")
        });
        _admit(c.asset0, address(token0), true);
        _admit(c.asset1, address(token1), false);
        calendar.setLeaf(CalendarLeaf(c.asset0, 2026, 0, 9000, 20000, 2, keccak256("fixture")));

        deployer = new BellHookDeployer(predictedFactory, address(sessions), keccak256(type(BellHook).creationCode), address(oracle_hoisted));
        require(address(deployer) == predictedDeployer, "deployer prediction");

        PoolKey memory key = PoolKey(
            Currency.wrap(c.token0), Currency.wrap(c.token1), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(0)));
        bytes32 initHash = deployer.initCodeHash(c, key);
        createSalt = _mine(predictedDeployer, initHash);

        adapter = new TreasuryAdapter(
            manager, predictedFactory, TREASURY, RECIPIENT, _predictHook(predictedDeployer, createSalt, initHash),
            Currency.wrap(c.token0), Currency.wrap(c.token1), 60);
        require(address(adapter) == predictedAdapter, "adapter prediction");

        seedFactory = new TreasurySeedFactory(deployer, adapter, manager, createSalt);
        require(address(seedFactory) == predictedFactory, "factory prediction");

        request = CreateRequest({
            config: c, salt: bytes32(uint256(7)), nonce: 0, deadline: 10100, recipient: RECIPIENT,
            sqrtPriceX96: uint160(1 << 96), tickLower: -120, tickUpper: 120, liquidity: 1_000_000,
            amountMax: [uint128(10000), uint128(10000)], maxServiceFee: 0
        });

        token0.mint(TREASURY, 1e9);
        token1.mint(TREASURY, 1e9);
        vm.prank(TREASURY);
        token0.approve(address(adapter), type(uint256).max);
        vm.prank(TREASURY);
        token1.approve(address(adapter), type(uint256).max);
        token0.mint(STRANGER, 1e9);
        token1.mint(STRANGER, 1e9);

        (hook, requestHash, posKey) = seedFactory.createAndSeedTreasury(request);
    }

    function testSeedActivatesFailClosedAndRecordsPosition() external view {
        require(hook != address(0) && posKey != bytes32(0), "seed result");
        require(BellHook(hook).config().treasuryAdapter == address(adapter), "two-way binding");
        require(
            BellHook(hook).state().lifecycle == uint8(2) /* LIVE */
            && BellHook(hook).getPolicy().mode != uint8(Mode.RECOVERING), "M05-05 gate");
        TreasuryAdapter.Position memory p = adapter.position(posKey);
        require(p.active && p.liquidity == request.liquidity && p.principal0 > 0 && p.principal1 > 0, "position record");
        require(adapter.position(bytes32(uint256(999))).liquidity == 0, "unknown key must be empty");
        uint128[2] memory seedPrincipal = BellHook(hook).seedPrincipal();
        require(seedPrincipal[0] == p.principal0 && seedPrincipal[1] == p.principal1, "principal binding");
        // No adapter custody: everything above the exact principal was refunded to the treasury.
        require(token0.balanceOf(address(adapter)) == 0 && token1.balanceOf(address(adapter)) == 0, "adapter dust");
        require(token0.balanceOf(address(manager)) == seedPrincipal[0], "core holds principal0");
        require(token1.balanceOf(address(manager)) == seedPrincipal[1], "core holds principal1");
    }

    function testSeedIsFactoryOnlyAndOneShot() external {
        vm.prank(STRANGER);
        (bool ok, bytes memory reason) = address(adapter).call(
            abi.encodeCall(adapter.seed, (requestHash, request)));
        require(!ok && bytes4(reason) == TreasuryAdapter.Unauthorized.selector, "stranger seed");
        // One seed for the adapter lifetime: the hook lifecycle allows exactly one.
        (ok, reason) = address(seedFactory).call(abi.encodeCall(seedFactory.createAndSeedTreasury, (request)));
        require(!ok, "second seed accepted");
        require(BellHook(hook).state().lifecycle == uint8(2), "state corrupted by second seed");
    }

    function testRemoveAndCollectAreTreasuryOnly() external {
        (bool ok, bytes memory reason) = _callRemove(STRANGER, posKey, 1000, 0, 0);
        require(!ok && bytes4(reason) == TreasuryAdapter.Unauthorized.selector, "stranger remove");
        (ok, reason) = _callRemove(RECIPIENT, posKey, 1000, 0, 0);
        require(!ok && bytes4(reason) == TreasuryAdapter.Unauthorized.selector, "recipient remove");
        (ok, reason) = _callCollect(STRANGER, posKey, 0, 0);
        require(!ok && bytes4(reason) == TreasuryAdapter.Unauthorized.selector, "stranger collect");
        (ok, reason) = _callRemove(TREASURY, bytes32(uint256(999)), 1000, 0, request.deadline);
        require(!ok && bytes4(reason) == TreasuryAdapter.BadSeed.selector, "unknown position remove");
    }

    function testTreasuryRemoveIsInKindExactAndDeadlineBound() external {
        uint256 before0 = token0.balanceOf(RECIPIENT);
        uint256 before1 = token1.balanceOf(RECIPIENT);
        vm.prank(TREASURY);
        (uint128 out0, uint128 out1) = adapter.remove(posKey, request.liquidity / 2, 1, 1, request.deadline);
        require(out0 > 0 && out1 > 0, "in-kind removal");
        require(token0.balanceOf(RECIPIENT) == before0 + out0 && token1.balanceOf(RECIPIENT) == before1 + out1,
            "output must land on the immutable recipient");
        require(token0.balanceOf(address(adapter)) == 0 && token1.balanceOf(address(adapter)) == 0, "no custody");
        TreasuryAdapter.Position memory p = adapter.position(posKey);
        require(p.active && p.liquidity == request.liquidity - request.liquidity / 2, "partial state");
        // Treasury exit never touches hook budget accounting.
        uint128[2] memory principal = BellHook(hook).seedPrincipal();
        require(principal[0] == p.principal0 && principal[1] == p.principal1, "seed changed by exit");

        (bool ok, bytes memory reason) = _callRemove(TREASURY, posKey, 1000, type(uint128).max, request.deadline);
        require(!ok && bytes4(reason) == TreasuryAdapter.SlippageExceeded.selector, "minima bypass");
        (ok, reason) = _callRemove(TREASURY, posKey, 1000, 0, 0);
        require(!ok && bytes4(reason) == TreasuryAdapter.DeadlineExpired.selector, "deadline bypass");
        (ok, reason) = _callRemove(TREASURY, posKey, request.liquidity, 0, request.deadline);
        require(!ok && bytes4(reason) == TreasuryAdapter.BadSeed.selector, "over-remove bypass");
    }

    function testRemoveMinimumIsPrincipalOnlyWhileReturnedAmountIncludesFees() external {
        _donate(1_000_000, 1_000_000);
        vm.prank(TREASURY);
        (uint128 fee0, uint128 fee1) = adapter.collect(posKey, 0, 0, request.deadline);
        require(fee0 > 100 && fee1 > 100, "fixture must accrue fees");

        _donate(1_000_000, 1_000_000);
        uint256 principal0 = SqrtPriceMath.getAmount0Delta(
            TickMath.getSqrtPriceAtTick(0), TickMath.getSqrtPriceAtTick(request.tickUpper),
            request.liquidity, false);
        uint256 principal1 = SqrtPriceMath.getAmount1Delta(
            TickMath.getSqrtPriceAtTick(request.tickLower), TickMath.getSqrtPriceAtTick(0),
            request.liquidity, false);
        uint128 min0 = uint128(principal0 + 10);
        uint128 min1 = uint128(principal1 + 10);
        (bool ok, bytes memory reason) = _callRemoveWithMins(
            TREASURY, posKey, request.liquidity, min0, min1, request.deadline);
        require(!ok && bytes4(reason) == TreasuryAdapter.SlippageExceeded.selector,
            "accrued fees must not mask principal minimum failure");
        require(adapter.position(posKey).liquidity == request.liquidity, "failed minima mutated position");
    }

    function testFullExitNeedsNoOracleAndClearsPosition() external {
        sessions.setRevertReads(true);
        uint256 before0 = token0.balanceOf(RECIPIENT);
        uint256 before1 = token1.balanceOf(RECIPIENT);
        vm.prank(TREASURY);
        (uint128 out0, uint128 out1) = adapter.remove(posKey, request.liquidity, 0, 0, request.deadline);
        require(out0 > 0 && out1 > 0, "full exit in-kind");
        require(token0.balanceOf(RECIPIENT) == before0 + out0 && token1.balanceOf(RECIPIENT) == before1 + out1,
            "full exit recipient");
        TreasuryAdapter.Position memory p = adapter.position(posKey);
        require(!p.active && p.liquidity == 0 && p.principal0 == 0 && p.principal1 == 0, "position not cleared");
        require(token0.balanceOf(address(adapter)) == 0 && token1.balanceOf(address(adapter)) == 0, "dust after exit");
        require(BellHook(hook).state().lifecycle == uint8(2), "exit must not change lifecycle");
    }

    function testCollectRequiresActualCredits() external {
        vm.prank(TREASURY);
        (uint128 fee0, uint128 fee1) = adapter.collect(posKey, 0, 0, request.deadline);
        require(fee0 == 0 && fee1 == 0, "invented fees before any swap");
        (bool ok, bytes memory reason) = _callCollect(TREASURY, posKey, 1, request.deadline);
        require(!ok && bytes4(reason) == TreasuryAdapter.SlippageExceeded.selector, "fee minimum bypass");
        require(token0.balanceOf(address(adapter)) == 0 && token1.balanceOf(address(adapter)) == 0, "collect custody");
    }

    function testForeignTokensSentToAdapterAreUnsweepable() external {
        token0.mint(address(adapter), 777);
        token1.mint(address(adapter), 888);
        vm.prank(TREASURY);
        adapter.remove(posKey, request.liquidity / 2, 0, 0, request.deadline);
        vm.prank(TREASURY);
        adapter.collect(posKey, 0, 0, request.deadline);
        require(token0.balanceOf(address(adapter)) == 777 && token1.balanceOf(address(adapter)) == 888,
            "foreign balances must be unreachable");
        (bool ok, bytes memory reason) = _callRemove(STRANGER, posKey, 1000, 0, 0);
        require(!ok && bytes4(reason) == TreasuryAdapter.Unauthorized.selector, "foreign balance sweep");
    }

    function testSenderTaxCannotConsumeForeignAdapterDustDuringExit() external {
        token0.mint(address(adapter), 100);
        token0.setSenderTax(true);
        uint256 beforeRecipient = token0.balanceOf(RECIPIENT);
        (bool ok, bytes memory reason) = _callRemove(TREASURY, posKey, request.liquidity / 2, 0, request.deadline);
        require(!ok && bytes4(reason) == TreasuryAdapter.SettlementMismatch.selector, "sender tax accepted");
        require(token0.balanceOf(address(adapter)) == 100, "foreign dust consumed");
        require(token0.balanceOf(RECIPIENT) == beforeRecipient, "recipient paid on failed exit");
        require(adapter.position(posKey).liquidity == request.liquidity, "position changed on failed exit");
    }

    function testUndercreditedCoreTakeCannotConsumeForeignAdapterDust() external {
        token0.mint(address(adapter), 100);
        token0.setReceiverTax(address(adapter), 1);
        uint256 beforeRecipient = token0.balanceOf(RECIPIENT);
        (bool ok, bytes memory reason) = _callRemove(TREASURY, posKey, request.liquidity / 2, 0, request.deadline);
        require(!ok && bytes4(reason) == TreasuryAdapter.SettlementMismatch.selector, "undercredited TAKE accepted");
        require(token0.balanceOf(address(adapter)) == 100, "foreign dust consumed");
        require(token0.balanceOf(RECIPIENT) == beforeRecipient, "recipient paid on failed exit");
        require(adapter.position(posKey).liquidity == request.liquidity, "position changed on failed exit");
    }

    function _callRemove(address who, bytes32 key_, uint128 liquidity, uint128 min0, uint64 deadline)
        private returns (bool ok, bytes memory reason)
    {
        vm.prank(who);
        (ok, reason) = address(adapter).call(abi.encodeCall(adapter.remove, (key_, liquidity, min0, min0, deadline)));
    }

    function _callRemoveWithMins(address who, bytes32 key_, uint128 liquidity, uint128 min0, uint128 min1, uint64 deadline)
        private returns (bool ok, bytes memory reason)
    {
        vm.prank(who);
        (ok, reason) = address(adapter).call(abi.encodeCall(adapter.remove, (key_, liquidity, min0, min1, deadline)));
    }

    function _callCollect(address who, bytes32 key_, uint128 min0, uint64 deadline)
        private returns (bool ok, bytes memory reason)
    {
        vm.prank(who);
        (ok, reason) = address(adapter).call(abi.encodeCall(adapter.collect, (key_, min0, min0, deadline)));
    }

    function _donate(uint128 amount0, uint128 amount1) private {
        token0.mint(address(this), amount0);
        token1.mint(address(this), amount1);
        manager.unlock(abi.encode(BellHook(hook).poolKey(), amount0, amount1));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only core");
        (PoolKey memory key, uint128 amount0, uint128 amount1) = abi.decode(data, (PoolKey, uint128, uint128));
        manager.donate(key, amount0, amount1, bytes(""));
        manager.sync(key.currency0);
        require(token0.transfer(address(manager), amount0), "token0 donation");
        manager.settle();
        manager.sync(key.currency1);
        require(token1.transfer(address(manager), amount1), "token1 donation");
        manager.settle();
        return bytes("");
    }

    function _predictHook(address deployerAddress, bytes32 salt, bytes32 initHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployerAddress, salt, initHash)))));
    }

    function _mine(address deployerAddress, bytes32 initHash) private pure returns (bytes32) {
        for (uint256 i; i < 500000; ++i) {
            bytes32 salt = bytes32(i);
            address h = _predictHook(deployerAddress, salt, initHash);
            if (uint160(h) & 0x3fff == 0x2cc0) return salt;
        }
        revert("salt search");
    }

    function _admit(bytes32 id, address token, bool stock) private {
        assets.admit(token, id);
        assets.setDescriptor(AssetDescriptor(
            id, token, stock, 6, 4, address(0), address(0), address(0), address(0), address(0),
            token.codehash, bytes32(uint256(1)), bytes32(uint256(1))));
        sessions.setHealth(id, HealthView(true, 0, 9000, 11000, 9900, 9950));
    }
}
