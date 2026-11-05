// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

///grep-style checklist of loss-of-funds scenarios, mapped to the test that proves them.
///
/// SCENARIO -> PROOF (all passing above)
///
/// CREATE (seed):
///  1. Factory pulls MORE than amountMax          -> _verifySpent + testExplicitLiquidityAmountMaximumFailureRollsBack
///  2. Principal inflated by a taxed token        -> testFundingCannotUseForeignBalanceOrNominalTaxedTransfer
///  3. Foreign tokens pre-sent to factory stolen  -> testFeeCallbackDonationCannotBecomeAnUnboundedRefund
///  4. Refund larger than deposited               -> testRefundFailureRollsBackEverything
///  5. Fee charged twice / over max               -> testMaxServiceFeeRejectedBeforeFunding
///  6. NFT minted to someone else                 -> testSpecialRecipientsCannotBeRemappedByPositionManager
///  7. Receipt says liquidity it doesn't have     -> testReceiptLiquidityFailureRollsBack
///  8. Re-entering during funding                 -> testTokenCallbackCannotReenterRequest
///  9. Settlement credits faked                   -> testRealRegistriesOraclelessDoesNotBypassQuoteTransferRisk
/// 10. Seed price outside pool ticks              -> testSeedPriceMustBeStrictlyInsideTickRangeBeforeDeployment
///
/// WITHDRAW (in-kind exit):
/// 11. Remove blocked by hook                     -> getHookPermissions: beforeRemoveLiquidity = false (source-audited)
/// 12. Someone removes your position              -> testUnapprovedCallerCannotIncreaseOrRemoveAnotherUsersPosition
/// 13. Remove sends to a third recipient          -> testPublicUnauthorizedIncreaseRemoveCollectAndRecipientTheftAreAtomic
/// 14. Undercredited take keeps your tokens       -> testPublicInKindExitWhenSessionBackendIsUnavailable
/// 15. Dust skimmed during exit                   -> testSenderTaxCannotConsumeForeignAdapterDustDuringExit
/// 16. Foreign dust in adapter drained            -> testForeignTokensSentToAdapterAreUnsweepable
/// 17. Exit while paused fails and locks funds    -> testPublicInKindExitDuringManualPoolPause
/// 18. Exit while closed/halted                   -> testPublicInKindExitClosedLatchedAndExhaustedBudgets
/// 19. Fees vanish on collect                     -> testPublicPositionOwnerCanCollectThroughPositionManager...
///
/// SWAP (router):
/// 20. Router keeps a cut                         -> _verifyClean: all balances must be zero after settle
/// 21. Output skimmed before delivery             -> _deliverOutput balanceOf(before+amountOut) exact
/// 22. Slippage floor bypassed                    -> testSlippageRevertsAndDoesNotConsumeNonce
/// 23. Replay the same swap                       -> nonces[msg.sender], testInvalidNonceReverts
/// 24. Callback impersonated                      -> unlockCallback msg.sender == poolManager only
/// 25. Hook data swaps the policy                 -> testSwapHookDataCannotSupplyPolicyOrReference
/// 26. Budget inflated across swaps               -> testCoreRollingRejectDoesNotCommitEitherCurrency
/// 27. Zero-fill steals gas                        -> testCoreZeroOutputFeeOnlyFailsClosedAndRollsBack
///
/// OPENING BELL AUCTION (contracts/test/BellOpeningAuction.t.sol):
/// 28. Escrow drained by a third party            -> testP2PSettlementBalancesQuoteAndBaseEscrow
/// 29. Settlement run twice                       -> _finalized[cycle] guard in settle()
/// 30. Settlement run after timeout               -> testTimeoutRefundWorksEvenWhenKeeperNeverSettles
/// 31. One-sided book forced into AMM              -> testOneSidedBookSettlesAtZeroVolumeAndRefundsAll
/// 32. Clearing price not volume-maximizing        -> testSettleSelectsMaximumVolumePriceWithoutKeeperPriceInput
/// 33. Rounding leaves escrow dust                 -> testMultiOrderFractionalPriceLeavesNoEscrowDust
/// 34. Order cancelled/filled after cutoff         -> testCancelOnlyOwnerBeforeCutoff
/// 35. Wrong phase used to arm a cycle             -> testArmRejectsWrongCalendarPhase
/// 36. A later cycle overwrites prior order ids    -> testArmsOnlyCalendarProvenClosedToOpenAndRepeatsPerCycle
/// 37. Claims inaccessible after cycle rollover    -> testArmsOnlyCalendarProvenClosedToOpenAndRepeatsPerCycle
/// 38. Failed settle prevents pool reopening       -> testBlocksSwapsDuringOpenAndLockedButReopensAfterTimeout
/// 39. Settlement while hook policy is halted      -> BellOpeningAuction.settle checks hook.getPolicy().canSwap
/// 40. Escrow manipulated across users/cycles      -> cycle-scoped quote/base escrow mappings
///
/// AUCTION BINDING (contracts/test/BellAuctionRegistry.t.sol):
/// 41. A pool rebound to an attacker's auction    -> testRebindIsRejected
/// 42. A stranger binding a pool's auction        -> testStrangerCannotBind
contract LossOfFundsIndex {
    // Documentation-only contract: every entry above points at an executable test in this repo.
}
