// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellOpeningAuction} from "./BellOpeningAuction.sol";
import {HaltRegistry} from "../registries/HaltRegistry.sol";

/// @title BellOpeningAuctionV2
/// @notice The opening auction, plus the reopening auction that follows a trading halt (Einstein Hooks v3).
/// @dev Everything about escrow, order entry, uniform-price clearing and refunds is inherited unchanged. The one addition is
///      `armResume`, a second way to arm a cycle: when the halt registry records a resume, the cycle opens for order entry at once and
///      locks `RESUME_AUCTION_SECONDS` later, mirroring how an exchange reopens a halted stock with an auction. While the cycle is
///      OPEN or LOCKED the existing `blocksSwaps` makes the hook revert swaps with `AuctionActive`, exactly as at the open.
///
///      After the window the registry is NORMAL, so the policy oracle stops pricing the pool as halted and the pool goes through the
///      ordinary closure recovery. `settle` therefore waits until the hook reports `canSwap`, and a cycle that cannot settle by its
///      deadline is refunded, the same as an opening cycle.
contract BellOpeningAuctionV2 is BellOpeningAuction {
    error BadHaltRegistry();
    error LeadTooShort();

    HaltRegistry public immutable haltRegistry;

    constructor(
        address factory_,
        address hook_,
        address calendarRegistry_,
        bytes32 assetId_,
        address quoteToken_,
        address baseToken_,
        uint32 auctionLead_,
        uint32 settleTimeout_,
        uint32 auctionMaximumCycles_,
        uint128 minOrderSizeQuote_,
        uint128 minOrderSizeBase_,
        uint8 maxOrders_,
        HaltRegistry haltRegistry_
    )
        BellOpeningAuction(
            factory_, hook_, calendarRegistry_, assetId_, quoteToken_, baseToken_, auctionLead_, settleTimeout_,
            auctionMaximumCycles_, minOrderSizeQuote_, minOrderSizeBase_, maxOrders_
        )
    {
        if (address(haltRegistry_).code.length == 0) revert BadHaltRegistry();
        // OPEN starts at openTime - auctionLead. A resume cycle opens RESUME_AUCTION_SECONDS after the resume, so the lead has to cover it
        // or order entry would start late.
        if (auctionLead_ < haltRegistry_.RESUME_AUCTION_SECONDS()) revert LeadTooShort();
        haltRegistry = haltRegistry_;
    }

    /// @notice Arms a cycle for the resume window the halt registry has recorded. Permissionless; returns false when there is nothing to arm.
    function armResume() external nonReentrant returns (bool) {
        HaltRegistry reg = haltRegistry;
        if (reg.phase(assetId) != HaltRegistry.Phase.RESUME_AUCTION) return false;
        HaltRegistry.Halt memory h = reg.current(assetId);
        uint64 openAt = h.resumedAt + reg.RESUME_AUCTION_SECONDS();
        return _arm(
            keccak256(abi.encode("BELL_RESUME", address(reg), assetId, h.haltId)),
            keccak256(abi.encode("BELL_HALT", assetId, h.haltId, h.startTs, h.reason)),
            keccak256(abi.encode("BELL_RESUME", assetId, h.haltId, h.resumeTs, h.resumedAt)),
            openAt
        );
    }
}
