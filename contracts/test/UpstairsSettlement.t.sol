// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {UpstairsSettlement} from "../src/upstairs/UpstairsSettlement.sol";
import {AssetDescriptor, CalendarLeaf, MarketPhase} from "../src/types/ProtocolTypes.sol";

interface VmUp {
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);

    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
}

contract UpTok is ERC20 {
    uint8 private immutable _d;

    constructor(string memory n, uint8 d_) ERC20(n, n) {
        _d = d_;
    }

    function decimals() public view override returns (uint8) {
        return _d;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

contract UpAssets {
    mapping(address => bytes32) public ids;
    mapping(bytes32 => AssetDescriptor) private _d;

    function add(address token, bool isStock, uint8 decimals_) external {
        bytes32 id = keccak256(abi.encode(token));
        ids[token] = id;
        _d[id].id = id;
        _d[id].token = token;
        _d[id].isStock = isStock;
        _d[id].decimals = decimals_;
    }

    function descriptorIdForToken(address token) external view returns (bytes32) {
        return ids[token];
    }

    function descriptor(bytes32 id) external view returns (AssetDescriptor memory) {
        return _d[id];
    }
}

contract UpCalendar {
    CalendarLeaf public leaf;
    bool public missing;

    function set(uint64 start, uint64 end, uint8 phase) external {
        leaf.start = start;
        leaf.end = end;
        leaf.phase = phase;
        missing = false;
    }

    function setMissing() external {
        missing = true;
    }

    function currentInterval(bytes32) external view returns (CalendarLeaf memory) {
        require(!missing, "no interval");
        return leaf;
    }
}

contract UpHalt {
    uint8 public p;

    function set(uint8 v) external {
        p = v;
    }

    function phase(bytes32) external view returns (uint8) {
        return p;
    }
}

contract UpFeed {
    uint8 public decimals = 8;
    int256 public answer;
    uint256 public updatedAt;

    function set(int256 a, uint256 t) external {
        answer = a;
        updatedAt = t;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @dev A contract wallet that vouches for one owner's signature, through ERC-1271.
contract UpWallet {
    address public owner;

    constructor(address o) {
        owner = o;
    }

    function isValidSignature(bytes32 h, bytes calldata sig) external view returns (bytes4) {
        return ECDSA.recover(h, sig) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract UpstairsSettlementTest {
    VmUp internal constant vm = VmUp(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant MAKER_PK = 0xA11CE;
    uint256 internal constant NOW = 1_800_000_000;
    uint256 internal constant REF = 150e18; // 150 USDG per share
    uint256 internal constant SHARES = 100e18;

    UpstairsSettlement internal s;
    UpTok internal stock;
    UpTok internal usdg;
    UpAssets internal assets;
    UpCalendar internal cal;
    UpHalt internal halt;
    UpFeed internal feed;
    address internal maker;
    address internal feeTo = address(0xFEE);

    function setUp() public {
        vm.warp(NOW);
        maker = vm.addr(MAKER_PK);
        stock = new UpTok("NVDA", 18);
        usdg = new UpTok("USDG", 6);
        assets = new UpAssets();
        assets.add(address(stock), true, 18);
        cal = new UpCalendar();
        cal.set(uint64(NOW - 1000), uint64(NOW + 1000), uint8(MarketPhase.REGULAR));
        halt = new UpHalt();
        feed = new UpFeed();
        feed.set(150e8, NOW - 10);
        address[] memory toks = new address[](1);
        toks[0] = address(stock);
        address[] memory feeds = new address[](1);
        feeds[0] = address(feed);
        s = new UpstairsSettlement(address(assets), address(cal), address(halt), address(usdg), feeTo, 5_000e6, 1_000_000e6, 6 hours, toks, feeds);
        stock.mint(maker, 1_000e18);
        usdg.mint(maker, 1_000_000e6);
        stock.mint(address(this), 1_000e18);
        usdg.mint(address(this), 1_000_000e6);
        vm.prank(maker);
        stock.approve(address(s), type(uint256).max);
        vm.prank(maker);
        usdg.approve(address(s), type(uint256).max);
        stock.approve(address(s), type(uint256).max);
        usdg.approve(address(s), type(uint256).max);
    }

    function _q(bool makerSells, uint256 shares, uint256 price, uint256 nonce) internal view returns (UpstairsSettlement.BlockQuote memory q) {
        q = UpstairsSettlement.BlockQuote({
            maker: maker,
            taker: address(this),
            stockToken: address(stock),
            quoteToken: address(usdg),
            makerSells: makerSells,
            stockAmount: shares,
            price: price,
            expiry: uint64(NOW + 60),
            nonce: nonce
        });
    }

    function _sig(UpstairsSettlement.BlockQuote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(MAKER_PK, s.quoteDigest(q));
        return abi.encodePacked(r, sv, v);
    }

    function _fill(UpstairsSettlement.BlockQuote memory q) internal returns (uint256, uint256) {
        return s.fill(q, _sig(q));
    }

    function _eq(uint256 a, uint256 b, string memory why) internal pure {
        require(a == b, why);
    }

    function test_revert_aboveBlockCap() public {
        // 7,000 shares at 150 USDG is 1,050,000 USDG, over the 1,000,000 USDG cap.
        stock.mint(maker, 10_000e18);
        usdg.mint(address(this), 2_000_000e6);
        UpstairsSettlement.BlockQuote memory q = _q(true, 7_000e18, REF, 24);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.AboveBlockCap.selector);
        s.fill(q, sig);
    }

    // ---------------------------------------------------------------- the two directions

    function test_makerSells_movesBothTokensAndPaysFee() public {
        uint256 stockBefore = stock.balanceOf(address(this));
        uint256 usdgBefore = usdg.balanceOf(address(this));
        (uint256 quoteAmount, uint256 fee) = _fill(_q(true, SHARES, REF, 1));
        _eq(quoteAmount, 15_000e6, "notional is 100 x 150 USDG");
        _eq(fee, 7_500_000, "5 bps of 15,000 USDG is 7.5 USDG"); // U9
        _eq(stock.balanceOf(address(this)), stockBefore + SHARES, "taker got the shares");
        _eq(usdg.balanceOf(address(this)), usdgBefore - quoteAmount - fee, "taker paid price plus fee");
        _eq(usdg.balanceOf(feeTo), fee, "the fee reached its address");
        _eq(usdg.balanceOf(address(s)) + stock.balanceOf(address(s)), 0, "the contract holds nothing");
    }

    function test_makerBuys_takerBearsFeeOutOfProceeds() public {
        uint256 usdgBefore = usdg.balanceOf(address(this));
        (uint256 quoteAmount, uint256 fee) = _fill(_q(false, SHARES, REF, 2));
        _eq(usdg.balanceOf(address(this)), usdgBefore + quoteAmount - fee, "taker received price minus fee");
        _eq(usdg.balanceOf(feeTo), fee, "fee address paid");
        _eq(stock.balanceOf(maker), 1_000e18 + SHARES, "maker received the shares");
    }

    function test_emitsBlockPrintWithSessionAndReference() public {
        vm.recordLogs();
        _fill(_q(true, SHARES, REF, 3));
        VmUp.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(s) && logs[i].topics[0] == UpstairsSettlement.BlockPrint.selector) {
                found = true;
                (bool ms, uint256 amt, uint256 price, uint256 ref, uint8 session, uint256 feeUsdg) =
                    abi.decode(logs[i].data, (bool, uint256, uint256, uint256, uint8, uint256));
                require(ms && amt == SHARES && price == REF && ref == REF, "print fields");
                _eq(session, uint8(MarketPhase.REGULAR), "session");
                _eq(feeUsdg, 7_500_000, "fee in the print");
            }
        }
        require(found, "no BlockPrint");
    }

    function test_contractWalletMakerThroughERC1271() public {
        UpWallet w = new UpWallet(maker);
        stock.mint(address(w), 1_000e18);
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 4);
        q.maker = address(w);
        vm.prank(address(w));
        stock.approve(address(s), type(uint256).max);
        s.fill(q, _sig(q));
        _eq(stock.balanceOf(address(w)), 900e18, "the wallet sold the shares");
    }

    // ---------------------------------------------------------------- the reverts, in the order of the brief

    function test_revert_wrongTaker() public {
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 10);
        q.taker = address(0xBEEF);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.BadQuote.selector);
        s.fill(q, sig);
    }

    function test_revert_signatureFromSomeoneElse() public {
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 11);
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(0xB0B, s.quoteDigest(q));
        vm.expectRevert(UpstairsSettlement.BadQuote.selector);
        s.fill(q, abi.encodePacked(r, sv, v));
    }

    function test_revert_tamperedQuote() public {
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 12);
        bytes memory sig = _sig(q);
        q.stockAmount = SHARES * 2;
        vm.expectRevert(UpstairsSettlement.BadQuote.selector);
        s.fill(q, sig);
    }

    function test_revert_wrongQuoteToken() public {
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 13);
        q.quoteToken = address(stock);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.BadQuote.selector);
        s.fill(q, sig);
    }

    function test_revert_expired() public {
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 14);
        bytes memory sig = _sig(q);
        vm.warp(NOW + 60);
        vm.expectRevert(UpstairsSettlement.Expired.selector);
        s.fill(q, sig);
    }

    function test_revert_expiryTooFar() public {
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 15);
        q.expiry = uint64(NOW + 121);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.ExpiryTooFar.selector);
        s.fill(q, sig);
    }

    function test_revert_replayOfTheSameQuote() public {
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 16);
        bytes memory sig = _sig(q);
        s.fill(q, sig);
        vm.expectRevert(UpstairsSettlement.NonceUsed.selector); // U6
        s.fill(q, sig);
    }

    function test_revert_cancelledNonce() public {
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 17);
        bytes memory sig = _sig(q);
        vm.prank(maker);
        s.cancelNonce(17);
        vm.expectRevert(UpstairsSettlement.NonceUsed.selector);
        s.fill(q, sig);
    }

    function test_cancelNonceOnlyCancelsTheCallersOwn() public {
        s.cancelNonce(18); // the test contract cancels its own nonce 18, not the maker's
        _fill(_q(true, SHARES, REF, 18));
    }

    function test_revert_assetNotAdmitted() public {
        UpTok other = new UpTok("OTHER", 18);
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 20);
        q.stockToken = address(other);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.AssetNotAdmitted.selector);
        s.fill(q, sig);
    }

    function test_revert_admittedButNotAStock() public {
        UpTok notStock = new UpTok("NOTSTOCK", 18);
        assets.add(address(notStock), false, 18);
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 21);
        q.stockToken = address(notStock);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.AssetNotAdmitted.selector);
        s.fill(q, sig);
    }

    function test_revert_belowBlockSize() public {
        // 33 shares at 150 USDG is 4,950 USDG, under the 5,000 USDG minimum: this belongs in the pool.
        UpstairsSettlement.BlockQuote memory q = _q(true, 33e18, REF, 22);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.BelowBlockSize.selector); // U7
        s.fill(q, sig);
    }

    function test_exactMinimumFills() public {
        // 33.333333333333333334 shares at 150 USDG is exactly 5,000.000000 USDG after rounding down: the smallest block that fills.
        (uint256 q,) = _fill(_q(true, 33_333_333_333_333_333_334, REF, 23));
        _eq(q, 5_000e6, "the minimum block");
    }

    function test_revert_closedSession() public {
        cal.set(uint64(NOW - 1000), uint64(NOW + 1000), uint8(MarketPhase.CLOSED));
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 30);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.UpstairsClosed.selector); // U5
        s.fill(q, sig);
    }

    function test_revert_unknownSession() public {
        cal.set(uint64(NOW - 1000), uint64(NOW + 1000), uint8(MarketPhase.UNKNOWN));
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 31);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.UpstairsClosed.selector);
        s.fill(q, sig);
    }

    function test_revert_noActiveInterval() public {
        cal.set(uint64(NOW - 2000), uint64(NOW - 1), uint8(MarketPhase.REGULAR));
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 32);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.UpstairsClosed.selector);
        s.fill(q, sig);
    }

    function test_revert_calendarHasNothing() public {
        cal.setMissing();
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 33);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.UpstairsClosed.selector);
        s.fill(q, sig);
    }

    function test_revert_halted() public {
        halt.set(1);
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 34);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.UpstairsClosed.selector);
        s.fill(q, sig);
    }

    function test_revert_resumeAuctionCountsAsHalted() public {
        halt.set(2);
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 35);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.UpstairsClosed.selector);
        s.fill(q, sig);
    }

    // ---------------------------------------------------------------- the band, per session

    function _bandCase(uint8 phase, uint256 bps, uint256 nonceBase) internal {
        cal.set(uint64(NOW - 1000), uint64(NOW + 1000), phase);
        uint256 edgeUp = REF * (10_000 + bps) / 10_000;
        uint256 edgeDown = REF * (10_000 - bps) / 10_000;
        _fill(_q(true, SHARES, edgeUp, nonceBase)); // exactly on the edge fills
        _fill(_q(true, SHARES, edgeDown, nonceBase + 1));
        UpstairsSettlement.BlockQuote memory up = _q(true, SHARES, edgeUp + 1, nonceBase + 2);
        bytes memory sigUp = _sig(up);
        vm.expectRevert(UpstairsSettlement.OutsideBand.selector); // U4
        s.fill(up, sigUp);
        UpstairsSettlement.BlockQuote memory down = _q(true, SHARES, edgeDown - 1, nonceBase + 3);
        bytes memory sigDown = _sig(down);
        vm.expectRevert(UpstairsSettlement.OutsideBand.selector);
        s.fill(down, sigDown);
    }

    function test_band_regular_50bps() public {
        _bandCase(uint8(MarketPhase.REGULAR), 50, 100);
    }

    function test_band_pre_100bps() public {
        _bandCase(uint8(MarketPhase.PRE), 100, 110);
    }

    function test_band_post_100bps() public {
        _bandCase(uint8(MarketPhase.POST), 100, 120);
    }

    function test_band_overnight_150bps() public {
        _bandCase(uint8(MarketPhase.OVERNIGHT), 150, 130);
    }

    function test_band_followsTheReferenceNotTheQuote() public {
        feed.set(160e8, NOW - 10); // the feed moved up 6.7%: the old price is now far outside the band
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 140);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.OutsideBand.selector);
        s.fill(q, sig);
    }

    // ---------------------------------------------------------------- the reference

    function test_revert_staleReference() public {
        feed.set(150e8, NOW - 6 hours - 1);
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 150);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.StaleReference.selector);
        s.fill(q, sig);
    }

    function test_revert_nonPositiveReference() public {
        feed.set(0, NOW - 10);
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 151);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.StaleReference.selector);
        s.fill(q, sig);
    }

    function test_revert_assetWithNoFeed() public {
        UpTok ant = new UpTok("ANT", 18);
        assets.add(address(ant), true, 18);
        ant.mint(maker, 1_000e18);
        vm.prank(maker);
        ant.approve(address(s), type(uint256).max);
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 152);
        q.stockToken = address(ant);
        bytes memory sig = _sig(q);
        vm.expectRevert(UpstairsSettlement.NoReference.selector);
        s.fill(q, sig);
    }

    // ---------------------------------------------------------------- nothing moves on a failure

    function test_aFailedFillMovesNothing() public {
        uint256 a = usdg.balanceOf(address(this));
        uint256 b = stock.balanceOf(address(this));
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF * 2, 160);
        bytes memory sig = _sig(q);
        try s.fill(q, sig) {
            revert("should have reverted");
        } catch {}
        _eq(usdg.balanceOf(address(this)), a, "usdg unchanged");
        _eq(stock.balanceOf(address(this)), b, "stock unchanged");
        require(!s.nonceUsed(maker, 160), "a reverted fill does not spend the nonce");
    }

    function test_revert_makerMovedTheTokens() public {
        vm.prank(maker);
        stock.transfer(address(0xDEAD), 1_000e18);
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 161);
        bytes memory sig = _sig(q);
        try s.fill(q, sig) {
            revert("should have reverted");
        } catch {}
        require(!s.nonceUsed(maker, 161), "nothing was spent");
    }

    // ---------------------------------------------------------------- the constructor

    function test_constructorRefusesBadConfig() public {
        address[] memory none = new address[](0);
        vm.expectRevert(UpstairsSettlement.BadConfig.selector);
        new UpstairsSettlement(address(0), address(cal), address(halt), address(usdg), feeTo, 5_000e6, 1_000_000e6, 6 hours, none, none);
        vm.expectRevert(UpstairsSettlement.BadConfig.selector);
        new UpstairsSettlement(address(assets), address(cal), address(halt), address(usdg), feeTo, 0, 1_000_000e6, 6 hours, none, none);
        vm.expectRevert(UpstairsSettlement.BadConfig.selector); // a cap below the minimum
        new UpstairsSettlement(address(assets), address(cal), address(halt), address(usdg), feeTo, 5_000e6, 1_000e6, 6 hours, none, none);
        address[] memory toks = new address[](1);
        toks[0] = address(stock);
        vm.expectRevert(UpstairsSettlement.BadConfig.selector);
        new UpstairsSettlement(address(assets), address(cal), address(halt), address(usdg), feeTo, 5_000e6, 1_000_000e6, 6 hours, toks, none);
    }

    function test_noHaltRegistryIsAllowed() public {
        address[] memory toks = new address[](1);
        toks[0] = address(stock);
        address[] memory feeds = new address[](1);
        feeds[0] = address(feed);
        UpstairsSettlement t = new UpstairsSettlement(address(assets), address(cal), address(0), address(usdg), feeTo, 5_000e6, 1_000_000e6, 6 hours, toks, feeds);
        stock.approve(address(t), type(uint256).max);
        usdg.approve(address(t), type(uint256).max);
        vm.prank(maker);
        stock.approve(address(t), type(uint256).max);
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, REF, 170);
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(MAKER_PK, t.quoteDigest(q));
        t.fill(q, abi.encodePacked(r, sv, v));
    }

    // ---------------------------------------------------------------- properties

    /// @dev For any price, a fill succeeds exactly when it is inside the REGULAR band around the reference.
    function testFuzz_regularBand(uint256 price) public {
        price = price % (400e18) + 50e18; // 50 to 450 USDG per share, so 100 shares is always at or above the 5,000 USDG minimum
        UpstairsSettlement.BlockQuote memory q = _q(true, SHARES, price, 900);
        bytes memory sig = _sig(q);
        uint256 diff = price > REF ? price - REF : REF - price;
        bool inside = diff * 10_000 <= REF * 50;
        if (inside) {
            s.fill(q, sig);
        } else {
            vm.expectRevert(UpstairsSettlement.OutsideBand.selector);
            s.fill(q, sig);
        }
    }

    /// @dev The fee is always the ceiling of 5 bps and the contract never keeps a balance.
    function testFuzz_feeAndNoCustody(uint256 shares) public {
        shares = shares % (900e18) + 40e18; // 40 to 940 shares: always at or above the minimum
        (uint256 quoteAmount, uint256 fee) = _fill(_q(true, shares, REF, 901));
        require(fee * 10_000 >= quoteAmount * 5 && (fee - 1) * 10_000 < quoteAmount * 5, "fee is the ceiling of 5 bps");
        _eq(usdg.balanceOf(address(s)) + stock.balanceOf(address(s)), 0, "no custody");
    }
}
