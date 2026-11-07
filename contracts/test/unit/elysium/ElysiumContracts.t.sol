// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestToken} from "../../../src/fixtures/TestToken.sol";
import {ElysiumFeeSplitter} from "../../../src/ElysiumFeeSplitter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface VmElysium {
    function warp(uint256) external;
    function prank(address) external;
}

contract ElysiumContractsTest {
    VmElysium private constant vm = VmElysium(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant BELL_BUYBACK = address(0xB311);
    address private constant KNTQ_BUYBACK = address(0x4E7A);
    address private constant TREASURY = address(0x7EA5);
    address private constant ALICE = address(0xA11CE);

    // ---------------------------------------------------------------------------------------------------------------
    // TestToken
    // ---------------------------------------------------------------------------------------------------------------

    function _token() private returns (TestToken) {
        vm.warp(1_000_000);
        return new TestToken("tAAPL (BELL test)", "tAAPL", 18, address(this), 1000e18);
    }

    function testTokenNameMustEndInBellTest() external {
        (bool ok,) = address(this).call(abi.encodeCall(this.deployNamed, ("Apple Inc.")));
        require(!ok, "a name that passes for a real asset was accepted");
        (ok,) = address(this).call(abi.encodeCall(this.deployNamed, ("AAPL (BELL test) x")));
        require(!ok, "suffix must be at the end");
        (ok,) = address(this).call(abi.encodeCall(this.deployNamed, ("")));
        require(!ok, "empty name accepted");
        (ok,) = address(this).call(abi.encodeCall(this.deployNamed, ("tUSDG (BELL test)")));
        require(ok, "valid test name refused");
    }

    function deployNamed(string calldata name_) external {
        new TestToken(name_, "T", 6, address(this), 1);
    }

    function testTokenDecimalsAndStatusGetters() external {
        TestToken t = new TestToken("tUSDG (BELL test)", "tUSDG", 6, address(this), 1000e6);
        require(t.decimals() == 6, "decimals");
        require(t.uiMultiplier() == 1e18 && t.newUIMultiplier() == 1e18, "multiplier");
        require(t.effectiveAt() == 0 && !t.oraclePaused(), "status");
    }

    function testOnlyOwnerMints() external {
        TestToken t = _token();
        t.mint(ALICE, 5);
        require(t.balanceOf(ALICE) == 5, "owner mint");
        vm.prank(ALICE);
        (bool ok,) = address(t).call(abi.encodeCall(t.mint, (ALICE, 1)));
        require(!ok, "non-owner minted");
    }

    function testFaucetOncePerDayPerAddress() external {
        TestToken t = _token();
        vm.prank(ALICE);
        t.faucet();
        require(t.balanceOf(ALICE) == 1000e18, "first faucet");
        vm.prank(ALICE);
        (bool ok,) = address(t).call(abi.encodeCall(t.faucet, ()));
        require(!ok, "second faucet within a day");
        // Not a shared limit: another address is unaffected.
        t.faucet();
        require(t.balanceOf(address(this)) == 1000e18, "other address");
        vm.warp(block.timestamp + 1 days);
        vm.prank(ALICE);
        t.faucet();
        require(t.balanceOf(ALICE) == 2000e18, "faucet after cooldown");
    }

    // ---------------------------------------------------------------------------------------------------------------
    // ElysiumFeeSplitter
    // ---------------------------------------------------------------------------------------------------------------

    function _splitter() private returns (ElysiumFeeSplitter) {
        return new ElysiumFeeSplitter(BELL_BUYBACK, KNTQ_BUYBACK, TREASURY, 4000, 3000, 3000);
    }

    function testSplitterConstructorRefusesBadConfiguration() external {
        (bool ok,) = address(this).call(abi.encodeCall(this.deploySplitter, (address(0), KNTQ_BUYBACK, TREASURY, 4000, 3000, 3000)));
        require(!ok, "zero recipient");
        (ok,) = address(this).call(abi.encodeCall(this.deploySplitter, (BELL_BUYBACK, BELL_BUYBACK, TREASURY, 4000, 3000, 3000)));
        require(!ok, "duplicate recipient");
        (ok,) = address(this).call(abi.encodeCall(this.deploySplitter, (BELL_BUYBACK, KNTQ_BUYBACK, TREASURY, 4000, 3000, 2999)));
        require(!ok, "shares below 10000");
        (ok,) = address(this).call(abi.encodeCall(this.deploySplitter, (BELL_BUYBACK, KNTQ_BUYBACK, TREASURY, 4000, 3000, 3001)));
        require(!ok, "shares above 10000");
        (ok,) = address(this).call(abi.encodeCall(this.deploySplitter, (BELL_BUYBACK, KNTQ_BUYBACK, TREASURY, 7000, 3000, 0)));
        require(!ok, "zero share");
        (ok,) = address(this).call(abi.encodeCall(this.deploySplitter, (BELL_BUYBACK, KNTQ_BUYBACK, TREASURY, 4000, 3000, 3000)));
        require(ok, "valid configuration refused");
    }

    function deploySplitter(address a, address b, address c, uint16 x, uint16 y, uint16 z) external {
        new ElysiumFeeSplitter(a, b, c, x, y, z);
    }

    function testDistributeSplitsExactlyAndLeavesNothingBehind() external {
        TestToken t = _token();
        ElysiumFeeSplitter s = _splitter();
        t.mint(address(s), 49e6);
        vm.prank(ALICE); // anyone may call it
        s.distribute(IERC20(address(t)));
        require(t.balanceOf(BELL_BUYBACK) == 49e6 * 4000 / 10_000, "bell share");
        require(t.balanceOf(KNTQ_BUYBACK) == 49e6 * 3000 / 10_000, "kntq share");
        require(t.balanceOf(TREASURY) == 49e6 - 49e6 * 4000 / 10_000 - 49e6 * 3000 / 10_000, "treasury share");
        require(t.balanceOf(address(s)) == 0, "funds held back");
        require(
            t.balanceOf(BELL_BUYBACK) + t.balanceOf(KNTQ_BUYBACK) + t.balanceOf(TREASURY) == 49e6, "total changed"
        );
    }

    function testDistributeRoundingRemainderGoesToTreasury() external {
        TestToken t = _token();
        ElysiumFeeSplitter s = _splitter();
        t.mint(address(s), 7); // 4000/10000 of 7 = 2, 3000/10000 of 7 = 2, remainder 3
        s.distribute(IERC20(address(t)));
        require(t.balanceOf(BELL_BUYBACK) == 2 && t.balanceOf(KNTQ_BUYBACK) == 2 && t.balanceOf(TREASURY) == 3, "rounding");
        require(t.balanceOf(address(s)) == 0, "dust left");
    }

    function testDistributeWithNothingRevertsAndIsRepeatable() external {
        TestToken t = _token();
        ElysiumFeeSplitter s = _splitter();
        (bool ok,) = address(s).call(abi.encodeCall(s.distribute, (IERC20(address(t)))));
        require(!ok, "empty distribution succeeded");
        t.mint(address(s), 100);
        s.distribute(IERC20(address(t)));
        t.mint(address(s), 100);
        s.distribute(IERC20(address(t)));
        require(t.balanceOf(BELL_BUYBACK) == 80 && t.balanceOf(KNTQ_BUYBACK) == 60 && t.balanceOf(TREASURY) == 60, "two rounds");
    }

    function testSharesAreImmutableAndThereIsNoAdminSurface() external {
        ElysiumFeeSplitter s = _splitter();
        require(s.bellBps() == 4000 && s.kntqBps() == 3000 && s.treasuryBps() == 3000, "shares");
        require(s.bellBuyback() == BELL_BUYBACK && s.kntqBuyback() == KNTQ_BUYBACK && s.treasury() == TREASURY, "recipients");
        // No owner, no setter: the only state-changing selector the contract answers to is distribute(address).
        bytes4[5] memory guesses = [
            bytes4(keccak256("setShares(uint16,uint16,uint16)")),
            bytes4(keccak256("setTreasury(address)")),
            bytes4(keccak256("transferOwnership(address)")),
            bytes4(keccak256("upgradeTo(address)")),
            bytes4(keccak256("withdraw(address,uint256)"))
        ];
        for (uint256 i; i < guesses.length; ++i) {
            (bool ok,) = address(s).call(abi.encodePacked(guesses[i], bytes32(uint256(1)), bytes32(uint256(1)), bytes32(uint256(1))));
            require(!ok, "an admin selector exists");
        }
    }

    function testSwapFeesNeverPassThrough() external {
        // The splitter only moves what has been sent to it. It holds no allowance and pulls from no pool.
        TestToken t = _token();
        ElysiumFeeSplitter s = _splitter();
        t.mint(ALICE, 1000);
        require(t.allowance(ALICE, address(s)) == 0, "allowance");
        (bool ok,) = address(s).call(abi.encodeCall(s.distribute, (IERC20(address(t)))));
        require(!ok, "distribution pulled funds that were not sent");
        require(t.balanceOf(ALICE) == 1000, "alice touched");
    }
}
