# BELL Product UI and Landing Redesign

## Goal

Make the live BELL app and its public landing page feel like one coherent, trustworthy product. Token and pool choices must show their logos, and all public claims must match the verified Mainnet state.

## Current verified state

- BELL is deployed to Robinhood Chain Mainnet, chain 4663.
- AAPL, NVDA, TSLA, USDG, WETH, and MEME are admitted. MEME is eligible for `SESSION_ONLY` only and has no independent price reference.
- The live pool directory currently returns no pools. There is no seeded Mainnet liquidity or completed Mainnet swap.
- The wallet app supports pool creation/seeding, exact-input and exact-output swaps, pool policy reads, PositionManager NFT discovery, in-kind removal, and fee collection.
- Yahoo source rights and independent security audit are not verified. These are product readiness limits, not accomplishments to imply.
- UI examples must be labeled illustrative and must never be presented as live quotes, balances, pools, or returns.

## Design direction

Use a precise market-terminal visual language: warm off-white data surfaces against graphite, restrained BELL red for action/status, clear mono labels for onchain facts, and large readable sans-serif headings. Keep the existing brand marks and token logos. Give the app consistent page rails, pair cards, policy/status hierarchy, and responsive navigation. Reduce decorative treatment where it competes with wallet actions or onchain values.

## App behavior and structure

1. Replace native asset selectors in Create with the accessible shared logo selector. Each option shows its actual token mark, symbol, asset type and admission state; selected pair remains visible with both marks. Keep registry checks authoritative and never expose unsupported assets.
2. Replace the Swap pool selector with the same control, showing both token marks and the pool's class/trading state. Preserve exact-input/exact-output bounds, wallet approvals, live policy checks and transaction confirmations.
3. Refine shared app navigation and page shells so wallet/network status, current route, errors and calls to action have a stable hierarchy on desktop and mobile.
4. Refine Pools, Pool details, Swap, Create, Positions and Protocol views around the actual tasks: browse, inspect constraints, quote, create, manage liquidity, and understand policy. Keep raw units exact and disclose when data is unavailable.
5. Preserve keyboard operation, focus visibility, accessible names, reduced-motion behavior, and narrow-screen overflow handling.

## Landing content flow

1. **Hero:** Explain session-aware liquidity in plain language and link to live pools and create flow. Do not imply that a pool already exists.
2. **How it works:** Show market/session checks, signed stock input, pool policy and swap execution; distinguish stock reference guards from pool spot price.
3. **Pool classes and asset fit:** Explain `PRICE_GUARDED` and `SESSION_ONLY`, including MEME's restriction and missing independent counterasset price protection.
4. **Product pathways:** Surface the working Create, Pools, Swap and Positions routes. State that users must create and seed a pool before it can trade.
5. **Risk / boundaries:** Explain fees, caps, closure behavior, in-kind LP exits, token/data-source risk, and that caps are not insurance or a return guarantee.
6. **Verified status:** Show chain, admitted asset set, live directory status, pull quote mode, unverified rights/audit gates, and snapshot time. Mark static facts as a timestamped snapshot; do not fake a live status feed.
7. **Close:** One clear next action for creating a pool and a secondary path to inspect protocol details.

## Acceptance criteria

- Every asset/pool dropdown used in product flows shows the token logo(s) for the selected item and each option.
- Create continues to offer only live admitted pairs and supported pool classes; MEME cannot select `PRICE_GUARDED`.
- Pool selection in Swap remains usable by keyboard and screen reader and does not change quote/swap semantics.
- All landing claims agree with `docs/CURRENT-STATE.md` and the checked live pool directory.
- No fictitious live pool, price, balance, customer, APR, audit, or source-rights claim is introduced.
- All primary app routes build and render with responsive, keyboard-accessible controls.

## Out of scope

Changing contracts, token admissions, oracle design, fee/cap policy, live pool creation or seeding, and representing rights/audit gates as complete.
