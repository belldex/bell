// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface VmFeeToken {
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function envUint(string calldata name) external view returns (uint256);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function addr(uint256 privateKey) external view returns (address);
    function writeFile(string calldata path, string calldata data) external;
    function toString(uint256 value) external pure returns (string memory);
}

/// @notice Rehearsal-only 6-decimal fee token. NOT USDG and not evidence of USDG identity:
/// the factory only cares about decimals (<=18) and exact-transfer behavior. Mint is open on
/// purpose so the rehearsal wallet can fund creators and recipients from a faucet-like flow.
contract RehearsalFeeToken is ERC20 {
    constructor() ERC20("BELL Rehearsal Fee", "mBELL") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract DeployFeeToken {
    VmFeeToken private constant vm = VmFeeToken(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address token) {
        require(block.chainid == 46630, "wrong chain: expected Robinhood testnet 46630");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint256 mintAmount = vm.envOr("TESTNET_FEE_TOKEN_MINT", uint256(1_000_000e6));
        vm.startBroadcast(pk);
        RehearsalFeeToken fee = new RehearsalFeeToken();
        fee.mint(deployer, mintAmount);
        vm.stopBroadcast();
        token = address(fee);
        vm.writeFile("../evidence/deploy/testnet-46630-fee-token.json", string.concat(
            '{\n  "chainId": ', vm.toString(block.chainid),
            ',\n  "feeToken": "', _hex(token),
            '",\n  "decimals": 6,\n  "mintedTo": "', _hex(deployer),
            '",\n  "amount": "', vm.toString(mintAmount),
            '",\n  "status": "REHEARSAL_FIXTURE",\n  "note": "Not USDG. Factory only checks decimals<=18 and exact transfers."\n}\n'
        ));
    }

    function _hex(address value) private pure returns (string memory) {
        bytes20 raw = bytes20(value);
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        bytes memory alphabet = "0123456789abcdef";
        for (uint256 i; i < 20; ++i) {
            out[2 + i * 2] = alphabet[uint8(raw[i] >> 4)];
            out[3 + i * 2] = alphabet[uint8(raw[i] & 0x0f)];
        }
        return string(out);
    }
}
