// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TreasuryAdapter} from "../../../src/TreasuryAdapter.sol";
import {BellHookDeployer} from "../../../src/BellHookDeployer.sol";
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {BellHook} from "../../../src/BellHook.sol";
import {CreateRequest, PoolConfig, AssetDescriptor, HealthView, CalendarLeaf} from "../../../src/types/ProtocolTypes.sol";
import {MockAssetRegistry, MockCalendarRegistry, MockSessionRegistry, MockSafetyController} from "../../unit/hook/BellHookLifecycle.t.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface VmStateful {
    function warp(uint256) external;
    function getNonce(address) external view returns (uint64);
    function computeCreateAddress(address, uint256) external pure returns (address);
    function prank(address) external;
}

contract StatefulToken is ERC20 {
    constructor() ERC20("Stateful Fixture", "STF") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract StatefulAdmission is MockAssetRegistry {
    mapping(address => bytes32) public descriptorIdForToken;
    function admit(address token, bytes32 id) external { descriptorIdForToken[token] = id; }
}

contract StatefulSeedFactory {
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

/// @dev Stateful/economic invariants for the restricted TreasuryAdapter (M13-02 partial, adapter
/// lane), driven as a deterministic randomized sequence under the fuzz runner. The nightly
/// foundry invariant runner silently exits (exit 1 after compile, no output) on this suite, so
/// the same invariants run as a seeded multi-step scenario: conservation of in-kind credits,
/// core principal accounting, unsweepable foreign balances, zero-success unauthorized attempts
/// and exact treasury debit, after every step.
contract TreasuryAdapterStatefulInvariantsTest {
    VmStateful private constant vm = VmStateful(address(uint160(uint256(keccak256("hevm cheat code")))));

    StatefulSeedFactory internal seedFactory;
    TreasuryAdapter internal adapter;
    PoolManager internal manager;
    StatefulToken internal token0;
    StatefulToken internal token1;
    StatefulAdmission internal assets;
    MockSessionRegistry internal sessions;
    MockCalendarRegistry internal calendar;
    MockSafetyController internal safety;
    PoolConfig internal config;
    address internal hook;
    bytes32 internal posKey;
    uint128[2] internal seedPrincipal;
    uint256 internal initRecipient0;
    uint256 internal initRecipient1;
    uint256 internal initTreasury0;

    uint256 internal ghostOut0;
    uint256 internal ghostOut1;
    uint256 internal foreign0;
    uint256 internal foreign1;
    uint256 internal strangerOut0;
    uint256 internal strangerOut1;

    address internal constant TREASURY = address(0xA11CE);
    address internal constant RECIPIENT = address(0xBEEF);
    address internal constant STRANGER = address(0xCAFE);

    function setUp() external {
        BellPolicyOracle oracle_hoisted = new BellPolicyOracle();
        vm.warp(10000);
        manager = new PoolManager(address(this));
        StatefulToken a = new StatefulToken();
        StatefulToken b = new StatefulToken();
        (token0, token1) = address(a) < address(b) ? (a, b) : (b, a);
        assets = new StatefulAdmission();
        sessions = new MockSessionRegistry();
        calendar = new MockCalendarRegistry();
        safety = new MockSafetyController();
        BellModeEvaluator modeEvaluator = new BellModeEvaluator();

        uint64 n0 = vm.getNonce(address(this));
        address predictedDeployer = vm.computeCreateAddress(address(this), n0);
        address predictedAdapter = vm.computeCreateAddress(address(this), n0 + 1);
        address predictedFactory = vm.computeCreateAddress(address(this), n0 + 2);

        config = PoolConfig({
            token0: address(token0), token1: address(token1),
            asset0: bytes32(uint256(1)), asset1: bytes32(uint256(2)),
            poolManager: address(manager), positionManager: address(manager), factory: predictedFactory,
            assetRegistry: address(assets), calendarRegistry: address(calendar),
            safetyController: address(safety), treasuryAdapter: predictedAdapter,
            poolClass: 1, liquidityMode: 1, referenceMode: 0, tickSpacing: 60,
            tradeCap: [uint128(10), uint128(10)], windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)], policyId: keccak256("candidate"),
            referenceAdapter0: address(0), referenceAdapter1: address(0)
        });
        _configureRegistries();

        BellHookDeployer deployer = new BellHookDeployer(predictedFactory, address(sessions), keccak256(type(BellHook).creationCode), address(oracle_hoisted), address(modeEvaluator));
        PoolKey memory key = PoolKey(Currency.wrap(config.token0), Currency.wrap(config.token1), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(0)));
        bytes32 initHash = deployer.initCodeHash(config, key);
        bytes32 createSalt = _mine(predictedDeployer, initHash);
        address predictedHook = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), predictedDeployer, createSalt, initHash)))));
        adapter = new TreasuryAdapter(manager, predictedFactory, TREASURY, RECIPIENT, predictedHook, Currency.wrap(config.token0), Currency.wrap(config.token1), 60);
        seedFactory = new StatefulSeedFactory(deployer, adapter, manager, createSalt);

        CreateRequest memory request = CreateRequest({
            config: config, salt: bytes32(uint256(7)), nonce: 0, deadline: 10100, recipient: RECIPIENT,
            sqrtPriceX96: uint160(1 << 96), tickLower: -120, tickUpper: 120, liquidity: 1_000_000,
            amountMax: [uint128(10000), uint128(10000)], maxServiceFee: 0
        });
        token0.mint(TREASURY, 1e9);
        token1.mint(TREASURY, 1e9);
        vm.prank(TREASURY);
        token0.approve(address(adapter), type(uint256).max);
        vm.prank(TREASURY);
        token1.approve(address(adapter), type(uint256).max);

        initRecipient0 = token0.balanceOf(RECIPIENT);
        initRecipient1 = token1.balanceOf(RECIPIENT);
        initTreasury0 = token0.balanceOf(TREASURY);

        (hook, , posKey) = seedFactory.createAndSeedTreasury(request);
        seedPrincipal = BellHook(hook).seedPrincipal();
    }

    function _configureRegistries() private {
        assets.admit(address(token0), config.asset0);
        assets.setDescriptor(AssetDescriptor(config.asset0, address(token0), true, 6, 4, address(0), address(0), address(0), address(0), address(0), address(token0).codehash, bytes32(uint256(1)), bytes32(uint256(1))));
        assets.admit(address(token1), config.asset1);
        assets.setDescriptor(AssetDescriptor(config.asset1, address(token1), false, 6, 4, address(0), address(0), address(0), address(0), address(0), address(token1).codehash, bytes32(uint256(1)), bytes32(uint256(1))));
        sessions.setHealth(config.asset0, HealthView(true, 0, 9000, 11000, 9900, 9950));
        sessions.setHealth(config.asset1, HealthView(true, 0, 9000, 11000, 9900, 9950));
        calendar.setLeaf(CalendarLeaf(config.asset0, 2026, 0, 9000, 20000, 2, keccak256("fixture")));
    }

    function testFuzz_StatefulTreasuryInvariants(uint256 seedInput) external {
        uint256 s = seedInput;
        for (uint256 step; step < 8; ++step) {
            s = uint256(keccak256(abi.encode(s)));
            TreasuryAdapter.Position memory p = adapter.position(posKey);
            uint8 action = uint8(s % 3);
            address caller = (s >> 8) % 2 == 0 ? TREASURY : STRANGER;
            if (action == 0 && p.active && p.liquidity != 0) {
                uint128 liquidity = uint128(1 + (uint256(keccak256(abi.encode(s, 1))) % p.liquidity));
                vm.prank(caller);
                (bool ok, bytes memory ret) = address(adapter).call(abi.encodeCall(adapter.remove,
                    (posKey, liquidity, uint128(0), uint128(0), uint64(block.timestamp) + 1000)));
                if (ok) {
                    (uint128 o0, uint128 o1) = abi.decode(ret, (uint128, uint128));
                    if (caller == TREASURY) { ghostOut0 += o0; ghostOut1 += o1; }
                    else { strangerOut0 += o0; strangerOut1 += o1; }
                }
            } else if (action == 1 && p.active) {
                vm.prank(caller);
                (bool ok, bytes memory ret) = address(adapter).call(abi.encodeCall(adapter.collect,
                    (posKey, uint128(0), uint128(0), uint64(block.timestamp) + 1000)));
                if (ok) {
                    (uint128 o0, uint128 o1) = abi.decode(ret, (uint128, uint128));
                    if (caller == TREASURY) { ghostOut0 += o0; ghostOut1 += o1; }
                    else { strangerOut0 += o0; strangerOut1 += o1; }
                }
            } else if (action == 2) {
                uint256 amount0 = uint256(keccak256(abi.encode(s, 2))) % 1000;
                uint256 amount1 = uint256(keccak256(abi.encode(s, 3))) % 1000;
                if (amount0 != 0) { token0.mint(address(adapter), amount0); foreign0 += amount0; }
                if (amount1 != 0) { token1.mint(address(adapter), amount1); foreign1 += amount1; }
            }
            _assertInvariants();
        }
    }

    function _assertInvariants() private view {
        TreasuryAdapter.Position memory p = adapter.position(posKey);
        // Recipient balance changes only by successful treasury in-kind credits.
        require(token0.balanceOf(RECIPIENT) == initRecipient0 + ghostOut0, "recipient0 conservation");
        require(token1.balanceOf(RECIPIENT) == initRecipient1 + ghostOut1, "recipient1 conservation");
        // Core holds exactly the principal minus what was taken out (no fees accrue: no swaps).
        require(token0.balanceOf(address(seedFactory.manager())) == uint256(seedPrincipal[0]) - ghostOut0, "core0 conservation");
        require(token1.balanceOf(address(seedFactory.manager())) == uint256(seedPrincipal[1]) - ghostOut1, "core1 conservation");
        // Foreign balances are unsweepable: the adapter holds exactly what was donated/minted in.
        require(token0.balanceOf(address(adapter)) == foreign0, "adapter0 unswept");
        require(token1.balanceOf(address(adapter)) == foreign1, "adapter1 unswept");
        // Unauthorized attempts never moved funds.
        require(strangerOut0 == 0 && strangerOut1 == 0, "stranger credits");
        // Position stays bounded by its seed; inactive implies zero residue.
        require(p.liquidity <= 1_000_000, "liquidity above seed");
        if (!p.active) require(p.liquidity == 0 && p.principal0 == 0 && p.principal1 == 0, "inactive residue");
        // Treasury net seed debit is exactly the principal (seed refund exactness).
        require(token0.balanceOf(TREASURY) == initTreasury0 - seedPrincipal[0], "treasury0 debit exact");
        require(token1.balanceOf(TREASURY) == 1e9 - seedPrincipal[1], "treasury1 debit exact");
    }

    function _mine(address deployerAddress, bytes32 initHash) private pure returns (bytes32) {
        for (uint256 i; i < 500000; ++i) {
            bytes32 salt = bytes32(i);
            address h = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployerAddress, salt, initHash)))));
            if (uint160(h) & 0x3fff == 0x2cc0) return salt;
        }
        revert("salt search");
    }
}
