// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PQKeyRegistry} from "../src/PQKeyRegistry.sol";

interface VmPQ {
    function startPrank(address caller) external;
    function stopPrank() external;
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
}

contract PQKeyRegistryTest {
    VmPQ private constant vm =
        VmPQ(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant ROLE_KEEPER = keccak256("KEEPER");
    address private constant ADMIN = address(0xA11CE);
    address private constant HYBRID_AUTH = address(0xBEEF);
    address private constant SIGNER = address(0xCAFE);
    bytes32 private constant COMMITMENT = keccak256("pq-key-root");

    PQKeyRegistry private registry;

    function setUp() public {
        registry = new PQKeyRegistry(ADMIN);
        vm.startPrank(ADMIN);
        registry.bootstrapRole(ROLE_KEEPER, SIGNER, COMMITMENT, 4);
        registry.setHybridAuth(HYBRID_AUTH);
        registry.finalizeBootstrap();
        vm.stopPrank();
    }

    function testBootstrapLocksAndRoleCanOnlyBeRotatedThroughHybridAuth()
        public
    {
        vm.prank(ADMIN);
        vm.expectRevert(PQKeyRegistry.BootstrapClosed.selector);
        registry.bootstrapRole(keccak256("REPORTER"), SIGNER, COMMITMENT, 2);

        vm.prank(ADMIN);
        vm.expectRevert(PQKeyRegistry.Unauthorized.selector);
        registry.rotateRoleKey(
            ROLE_KEEPER,
            address(0xD00D),
            keccak256("next-root"),
            8
        );
    }

    function testConsumesOnlyTheNextUnusedOneTimeLeaf() public {
        vm.startPrank(HYBRID_AUTH);
        registry.consumeLeaf(ROLE_KEEPER, 1, 1);

        vm.expectRevert(PQKeyRegistry.LeafOutOfOrder.selector);
        registry.consumeLeaf(ROLE_KEEPER, 1, 3);

        vm.expectRevert(PQKeyRegistry.LeafOutOfOrder.selector);
        registry.consumeLeaf(ROLE_KEEPER, 1, 1);

        registry.consumeLeaf(ROLE_KEEPER, 1, 2);
        vm.stopPrank();

        PQKeyRegistry.RoleKey memory current = registry.roleKey(ROLE_KEEPER);
        require(current.nextStatefulLeaf == 3, "leaf did not advance");
    }

    function testRotationIncrementsEpochAndResetsOnlyNewKeyLeafSequence()
        public
    {
        vm.prank(HYBRID_AUTH);
        registry.consumeLeaf(ROLE_KEEPER, 1, 1);

        vm.prank(HYBRID_AUTH);
        registry.rotateRoleKey(
            ROLE_KEEPER,
            address(0xD00D),
            keccak256("next-root"),
            8
        );

        PQKeyRegistry.RoleKey memory current = registry.roleKey(ROLE_KEEPER);
        require(current.ecdsaSigner == address(0xD00D), "signer not rotated");
        require(
            current.publicKeyCommitment == keccak256("next-root"),
            "commitment not rotated"
        );
        require(current.keyVersion == 2, "key version not incremented");
        require(current.maxStatefulSignatures == 8, "limit not updated");
        require(current.nextStatefulLeaf == 1, "new tree must start at leaf 1");
    }
}
