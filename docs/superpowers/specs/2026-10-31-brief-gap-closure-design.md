# Brief Gap Closure Design

## Goal

Close the product-facing gaps between the deployed Mainnet UI and the accepted BELL brief/implementation plan, with the pinned Robinhood Chain MEME asset admitted only after its identity and transfer behavior are reviewed.

## Current verified state

- Chain 4663 token `0x385F4f8ae47651ce5F58F5265395a669f8281e18` reads `A Meme Coin`, symbol `MEME`, 18 decimals, and is not active in the deployed AssetRegistry.
- Blockscout identifies the token as an ERC-1167 clone of verified `DopplerERC20V1`. The implementation is non-upgradeable by the clone pattern. Current reads report its balance limit inactive and pool lock set to the dead address; these are current facts, not a guarantee against token-holder or market risks.
- MEME has no admitted independent USD reference, so BELL must offer only `SESSION_ONLY` for MEME/stock and must disclose the absence of independent counterasset price protection.
- The creator UI and router are wallet-mediated. Governance admission and pool creation are distinct chain actions.

## Design

1. Add an evidence-pinned counterasset candidate and resumable AssetRegistry queue/activate tooling. The admission manifest records exact token/implementation identities, source verification, onchain metadata, transfer-policy findings, and explicit limitations. The existing deployed governance delay decides when activation is possible; no delay assumption is hard-coded.
2. Add only the active MEME descriptor to the Create options after its chain admission is confirmed. Verify the live descriptor and metadata before preparing the factory request. The MEME path is SESSION_ONLY; it never substitutes a pool spot price for an oracle.
3. Add a non-executable token intake check for other addresses: show live chain metadata and whether the token is admitted; reject all non-admitted tokens from Create and provide the exact evidence/admission requirements.
4. Complete the already deployed product UI against the brief: exact-input and exact-output swaps with amount and fee bounds, complete onchain pool state and limits, and position-owned principal/fee/output reporting plus direct in-kind exit.
5. Update the landing/legal/current-state text and traceability so completed UI work is distinguished from external gates that cannot be fabricated (source rights, independent audit, capacity/restore drills, wallet signatures, and live pool acceptance).

## Safety and failure behavior

- Unknown tokens never reach `queueAsset` or pool creation from a public UI path.
- MEME cannot be represented as PRICE_GUARDED without a separately admitted reference source.
- Admission aborts if live chain, code hash, decimals, symbol, implementation identity, registry authority, or simulation differs from the reviewed evidence.
- Every wallet write is simulated first, requires wallet confirmation, waits for a receipt, and is resumable/idempotent.
- Exact-output quotes use router simulation and preserve the user's output amount and chosen maximum input; a quote expiry or state change requires a fresh simulation.
- Position removal remains in-kind, with explicitly shown minimum outputs and no swap dependency.

## Acceptance

- Tests cover MEME identity/class restrictions, non-admitted custom assets, exact-output bounds, complete state rendering, and position transaction bounds.
- Worker/app production builds pass; admission scripts run in read-only/simulation modes without broadcasting.
- If the owner-authorized MEME admission transaction is executed, verify the resulting descriptor on Mainnet before enabling it in the published manifest/UI.
- External release gates remain visibly open until their own evidence exists.
