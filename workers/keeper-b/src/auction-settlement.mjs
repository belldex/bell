/**
 * Pure selection helpers for the scheduled Opening Bell Auction settlement.
 *
 * BellOpeningAuction computes its own P2P maximum-volume price from the limit order book. The keeper
 * only selects cycles that are LOCKED before their timeout and submits `settle()` with no price,
 * fills, or payout input.
 */
export function eligibleAuctions(pools, registryAuctions, nowSeconds) {
  const eligible = [];
  for (const pool of pools ?? []) {
    const auction = registryAuctions?.[String(pool.poolId).toLowerCase()];
    if (!auction || /^0x0{40}$/i.test(auction.address ?? auction)) continue;
    // BellOpeningAuction.Stage: LOCKED = 3; SETTLED = 4; REFUNDED = 5.
    if (auction.stage !== 3 || !auction.blocksSwaps) continue;
    if (Number(auction.openTime) > nowSeconds) continue;
    if (Number(auction.cycleDeadline) <= nowSeconds) continue;
    eligible.push({ pool, auction: String(auction.address ?? auction) });
  }
  return eligible;
}

export function auctionSettlementResult(address, status, extra = {}) {
  return { auction: address, status, ...extra };
}
