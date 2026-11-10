# Indexer, Terminal, and Aggregator Submission Status

Updated 10 November 2026. A prepared packet is not a submitted request, and a submitted request is not an accepted integration.

| Target | Official path / current requirement | Status | Next evidence |
| --- | --- | --- | --- |
| DEX Screener | Pool/token pages are generally indexed automatically after a pool exists and has a transaction; verify all BELL pairs through the public API. | CHECKED · BELL TOKEN NOT LISTED | On 10 November 2026, the public token query for `0xc5d6c1d90c8a87a07e2670b99b1556e818803228` returned `pairs: null`. This says nothing about unrelated stock/USDG pools. Check eligible pool creation and chain support before submitting. |
| GeckoTerminal | Verify network/pool through the public API. Token metadata update form applies to token information; it is not proof a BELL pool is indexed. | CHECK REQUIRED | Save API response and, if needed, submit the verified token-information form. |
| fomo | Submission/contact route not yet confirmed. | PREPARED | Identify an official project-integration form/contact before sending the pack. |
| GMGN | Official site exposes listing/social workflows, but suitability for a Robinhood Chain v4 pool is not established. | PREPARED | Confirm the exact official integration route and requested fields. |
| 1inch | Custom hook behavior may need explicit integration support; a pool is not automatically routable merely because it is Uniswap v4. | PREPARED | Send the integration pack through the official partner/developer support route and ask about Robinhood Chain 4663 + hook support. |
| 0x | Official docs provide a dedicated custom Uniswap v4 hook integration request form. | PREPARED | Submit the verified hook/pool list, status endpoint, receipt links, and exact router test evidence. |
| KyberSwap | Official integration route and support status not yet confirmed. | PREPARED | Confirm supported chain and custom-hook requirements before submission. |
| Odos | Official integration route and support status not yet confirmed. | PREPARED | Confirm supported chain and custom-hook requirements before submission. |
| Uniswap v4 Hook Routing Allowlist | Official hook routing allowlist form exists for hook builders. | PREPARED | Submit verified hook code/addresses, pool list, integration pack, and exact standard-router rehearsal results. |

Official references used for this status: [DEX Screener automatic token listing](https://docs.dexscreener.com/token-listing), [GeckoTerminal token-information form](https://www.geckoterminal.com/update-token-info), [GeckoTerminal API](https://api.geckoterminal.com/docs/index.html), [1inch custom-hook routing explanation](https://help.1inch.com/en/articles/16881967-why-1inch-may-not-route-through-certain-liquidity-pools), [0x custom v4 hook request](https://docs.0x.org/liquidity-integration/liquidity-integrations), and [Uniswap hook routing allowlist](https://developers.uniswap.org/hook-allowlist). DEX Screener documents that tokens become listed automatically when a pool exists and has at least one transaction; check the live API before filing a manual request.

## Evidence to attach

- [Integration pack](./README.md), including live `/pools`, receipt, and status endpoints.
- `apps/web/content/mainnet-pool-lenses.json` with observed block/time and each Lens address.
- `apps/web/content/mainnet-verification.json` with pool initialization, hook mask, fee receipts and rule-test status.
- Successful Universal Router transaction with empty hook data, **if and when one exists**; otherwise include the actual failure and requirements.
- Verified source links and exact `audit-v1` commit when frozen.

## Submission log

Append one row per actual attempt: UTC date, official destination, exact packet URL/hash, requester/account, acknowledgement or response, and any follow-up. Do not mark an item `SUBMITTED` without a real confirmation or receipt from the destination.

Read-only check: [DEX Screener BELL token query](https://api.dexscreener.com/latest/dex/tokens/0xc5d6c1d90c8a87a07e2670b99b1556e818803228), checked 10 November 2026, returned `{"schemaVersion":"1.0.0","pairs":null}`. No support request was sent.
