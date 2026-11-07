# Getting testnet HYPE on Elysium when every faucet says no

Prepared by **Asif** for the BELL project, 7 November 2026. This is the route that worked for a brand-new wallet
after every official faucet refused it. Every address below was checked on-chain on the day, and every step ends with
a check you can run.

> Testnet only. Testnet tokens have no value, and the testnet HYPE/USDC market is not priced like real HYPE.
> No private key goes anywhere except inside your own wallet extension.

## Contents

1. [Summary and result](#1-summary-and-result)
2. [What does not work](#2-what-does-not-work)
3. [The route at a glance](#3-the-route-at-a-glance)
4. [Before you start](#4-before-you-start)
5. [Steps 1 to 3: mainnet, account, drip](#5-steps-1-to-3-mainnet-account-drip)
6. [Steps 4 to 5: buy HYPE and move it](#6-steps-4-to-5-buy-hype-and-move-it)
7. [Steps 6 to 7: bridge and fund the deployer](#7-steps-6-to-7-bridge-and-fund-the-deployer)
8. [Pitfalls and troubleshooting](#8-pitfalls-and-troubleshooting)
9. [Final state, safety, API cheat sheet, glossary](#9-final-state-safety-api-cheat-sheet-glossary)

Use **one wallet** for every step. Replace `YOUR_WALLET` with your address and `DEPLOYER` with the wallet that will
deploy. After each step run its check. If the check does not show the expected value, fix that step before moving on.

---

## 1. Summary and result

Elysium testnet pays gas in HYPE, and the official faucets reject a new wallet. This route uses a few dollars of real
HYPE to activate a Hyperliquid account. That unlocks a testnet drip of 1,000 mock USDC, which is traded for testnet
HYPE and bridged into Elysium.

| | |
| --- | --- |
| Mainnet HYPE spent | about 0.05 HYPE (about $4 at $78) |
| Time | about 2 hours, mostly confirmations |
| Testnet HYPE that arrived on Elysium | 0.2341 HYPE |
| Headroom | about 16 deploys (one 15-contract deploy is estimated at 0.0126 HYPE) |

Every free route asks something a new wallet cannot show: an old HYPE balance, an ETH history, or activity. This
route replaces that with a small real deposit.

## 2. What does not work

| Route | Why it fails for a new wallet |
| --- | --- |
| Elysium faucet `testnet.elysium.kinetiq.xyz/faucet` | Returns `unfunded` ("try an address with a balance on HyperEVM or Hyperliquid mainnet") even with 0.1 HYPE on HyperEVM mainnet, because that HYPE was new |
| Quicknode (Hyperliquid and Elysium) | Needs a small mainnet balance held at least 3 days |
| Chainstack faucet | Needs 0.08 ETH on Ethereum mainnet plus ETH history |
| Gas.zip faucet | Needs about 0.01 ETH and 5 or more transactions in 30 days |
| ZalalenA faucet | Works with a captcha but pays 0.0001 HYPE per claim (about 13 days of claims for one deploy) |
| Alchemy faucet | The wallet passed the check, but the faucet showed "Insufficient faucet balance" |
| Circle faucet, then buy HYPE | 20 USDC per claim every 2 hours. The testnet market minimum order is 0.01 HYPE (about $40 to $70 here), so it takes many claims. Possible but slow |
| Orderly faucet (1,000 USDC) | Not tried. It issues Orderly's own test USDC, so it very likely cannot be deposited into Hyperliquid |
| Sending HYPE to `0x2222...2222` on its own | Does not create the HyperCore account. The HYPE sits in escrow and the role stays `missing` until activation |

## 3. The route at a glance

```
1  swap ~0.04 mainnet HYPE for ~3 USDC                      HyperEVM mainnet (999)
2  approve + deposit 3 USDC to the CoreDepositWallet        activates your HyperCore account
3  claim the testnet drip: 1,000 mock USDC                  needs a mainnet deposit
4  move USDC to spot, limit-buy HYPE on @1035               Hyperliquid testnet
5  Portfolio, EVM / Core: Core to EVM                       lands on HyperEVM testnet (998)
6  Elysium testnet bridge, 1:1                              lands on Elysium testnet (99801)
7  send the HYPE to the deploy wallet                       Elysium testnet
```

Timeline of the real run:

| Stage | What happened | Time |
| --- | --- | --- |
| Steps 1 and 2 | Swap, approve, deposit. Role changed from `missing` to `user`; spot showed 2.0 USDC and the escrowed 0.01 HYPE was released | about 15 min |
| Step 3 | The drip arrived within a minute of opening the page after activation | about 2 min |
| Step 4 | First limit order sat unfilled because the cheap ask was taken; a second limit at a higher ceiling filled; a second buy used the rest of the USDC | about 20 min |
| Steps 5 and 6 | Core to EVM was instant; the bridge credited Elysium in about one minute | about 5 min |

## 4. Before you start

- A browser wallet such as Rabby with **HyperEVM mainnet**, **HyperEVM testnet** and **Elysium testnet** added.
- At least **0.06 HYPE** (about $5) on **HyperEVM mainnet** in `YOUR_WALLET`. About 0.04 is swapped, the rest is gas.
- Optional: Foundry's `cast` for the checks. Each check also has a `curl` or browser equivalent.
- Never paste a private key or seed phrase into any website or chat.

Networks:

| Network | Chain id | RPC |
| --- | --- | --- |
| HyperEVM mainnet | 999 | `https://rpc.hyperliquid.xyz/evm` |
| HyperEVM testnet | 998 | `https://rpc.hyperliquid-testnet.xyz/evm` |
| Elysium testnet | 99801 | `https://testnet-rpc.elysium.kinetiq.xyz` |

Addresses (verified on-chain on 7 Nov 2026):

| What | Network | Address |
| --- | --- | --- |
| Native USDC (Circle) | HyperEVM mainnet | `0xb88339CB7199b77E23DB6E890353E22632Ba630f` |
| CoreDepositWallet | HyperEVM mainnet | `0x6b9e773128f453f5c2c60935ee2de2cbc5390a24` |
| System address, HyperEVM and HyperCore | both | `0x2222222222222222222222222222222222222222` |
| Testnet HYPE/USDC spot market | Hyperliquid testnet | `@1035`, HYPE token `0x7317beb7cceed72ef0b346074cc8e7ab` |
| Elysium bridge inbox | HyperEVM testnet | `0x11178Df40CBf87a4343f4B3F8B09B366ceFA8Ec0` |

The CoreDepositWallet address equals `evmContract.address` for USDC in the `spotMeta` response from
`api.hyperliquid.xyz/info`, and the explorer labels it "Circle: Core Deposit Wallet". Its
`deposit(uint256,uint32)` function was exercised with a read-only call before any signature.

## 5. Steps 1 to 3: mainnet, account, drip

### Step 1. Swap a little HYPE for USDC (HyperEVM mainnet)

1. In Rabby choose the HyperEVM network and open **Swap**.
2. Swap **0.04 HYPE** to **USDC**. The quote was about 3.11 USDC via 1inch, gas under one cent, slippage 1 percent,
   wallet fee 0.25 percent.
3. Keep roughly 0.05 HYPE for gas.

```bash
# native USDC balance, 6 decimals: 3112279 means 3.112279
cast call 0xb88339CB7199b77E23DB6E890353E22632Ba630f "balanceOf(address)(uint256)" YOUR_WALLET \
  --rpc-url https://rpc.hyperliquid.xyz/evm
```

The token must be the native one above. A different "USDC" is not accepted by step 2.

### Step 2. Activate your HyperCore account (HyperEVM mainnet)

A HyperCore account is created by the **first USDC deposit**. A new account is charged **1 USDC**, so the first
deposit must be **more than 1 USDC**. A deposit of 1 USDC or less fails silently. We deposit 3.

1. On the USDC contract (explorer, **Write as Proxy**), connect the wallet and call
   `approve(spender = 0x6b9e773128f453f5c2c60935ee2de2cbc5390a24, value = 3000000)`.
2. On the CoreDepositWallet (**Write as Proxy**) call `deposit(amount = 3000000, destinationDex = 4294967295)`.
   Leave the "Scale" selector alone.

`3000000` is 3 USDC (6 decimals). `4294967295` is `uint32.max` and sends the funds to the **spot** balance; `0` would
send them to the perps balance.

Check before you sign the deposit:

```bash
# allowance must read 3000000
cast call 0xb88339CB7199b77E23DB6E890353E22632Ba630f "allowance(address,address)(uint256)" YOUR_WALLET \
  0x6b9e773128f453f5c2c60935ee2de2cbc5390a24 --rpc-url https://rpc.hyperliquid.xyz/evm

# read-only call of the deposit: an empty 0x reply means it would succeed
cast call 0x6b9e773128f453f5c2c60935ee2de2cbc5390a24 "deposit(uint256,uint32)" 3000000 4294967295 \
  --from YOUR_WALLET --rpc-url https://rpc.hyperliquid.xyz/evm
```

Check after:

```bash
curl -s https://api.hyperliquid.xyz/info -H 'content-type: application/json' \
  -d '{"type":"userRole","user":"YOUR_WALLET"}'
# {"role":"user"}      (was {"role":"missing"})
```

Spot should show **2.0 USDC** (3 minus the 1 USDC activation fee). Any HYPE you had sent to `0x2222...2222` earlier
moves from escrow into the spot balance.

### Step 3. Claim the 1,000 mock USDC (Hyperliquid testnet)

1. Open `app.hyperliquid-testnet.xyz/drip` and connect the **same** wallet.
2. Click the claim button. The drip requires a mainnet deposit from that address, which step 2 provides.
3. If it still says "Already claimed" or stays grey, refresh after a minute and recheck that the role is `user`.

```bash
curl -s https://api.hyperliquid-testnet.xyz/info -H 'content-type: application/json' \
  -d '{"type":"clearinghouseState","user":"YOUR_WALLET"}'
# accountValue 999.0     (1,000 minus a 1 USDC activation fee)
```

The USDC arrives in the **perps** account. It must be on the **spot** side to buy HYPE.

## 6. Steps 4 to 5: buy HYPE and move it

### Step 4. Move USDC to spot and buy HYPE (Hyperliquid testnet)

1. **Portfolio, Perps / Spot**: direction Perps to Spot, move the amount you want to spend. The app may later show a
   combined balance after Enable Trading, which is fine.
2. Open **Trade** and select the **Spot** market **HYPE/USDC** (direct link `/trade/@1035`).
3. Click **Enable Trading** once and sign. It is an approval, no funds move.
4. Choose the **Limit** tab, side **Buy**, enter a price slightly above the best ask and a size in HYPE.

> **Do not trade the perp.** The page that often opens first is the **perp** `HYPE-USDC`: it shows 10x, Isolated,
> **Buy / Long** and **Sell / Short**. A perp cannot give you HYPE tokens. The spot page shows plain **Buy / Sell**, no
> leverage, and a token contract ending `e7ab`.

Read the book from the API, not from a screenshot:

```bash
curl -s https://api.hyperliquid-testnet.xyz/info -H 'content-type: application/json' \
  -d '{"type":"l2Book","coin":"@1035"}'
```

What we saw:

- This market is **not priced like real HYPE**. Asks ran from about $3,200 to $4,100 per HYPE, the minimum order is
  0.01 HYPE, and the book is thin.
- A cheap level (0.17 HYPE near $3,300) vanished between our look and our click, so a limit at 3,400 sat
  **unfilled** (open order, funds on hold, no fill).
- We cancelled it and placed a limit at 4,100. It filled at **4,088.5**. A limit price is a ceiling: you never pay more
  than it, but you must accept the real ask.
- We bought **0.1 HYPE** and then **0.14 HYPE** (about $409 and $572). Testnet USDC has no other use here, so spending
  it is free.

```bash
curl -s https://api.hyperliquid-testnet.xyz/info -H 'content-type: application/json' \
  -d '{"type":"spotClearinghouseState","user":"YOUR_WALLET"}'
# HYPE total 0.239832     (after both buys, fees paid in HYPE)
```

### Step 5. Move HYPE from HyperCore to HyperEVM testnet

1. **Portfolio, EVM / Core**.
2. Direction **Core to EVM**, token **HYPE**, amount a little under your balance (we sent 0.239 of 0.239832).
3. Confirm. Use this **or** a spot Send to `0x2222...2222`, not both.

```bash
cast balance YOUR_WALLET --rpc-url https://rpc.hyperliquid-testnet.xyz/evm --ether
# 0.2391
```

## 7. Steps 6 to 7: bridge and fund the deployer

### Step 6. Bridge to Elysium testnet

1. Open `elysium.kinetiq.xyz/testnet-bridge` and connect the same wallet on **HyperEVM testnet**.
2. Direction **HyperEVM Testnet to Elysium Testnet**. We sent **0.2341 HYPE** and kept about 0.005 HYPE on HyperEVM
   for gas.
3. Check in the wallet prompt that the destination is Elysium Testnet.

The bridge credits **the sending address** on Elysium, not a deploy wallet. Our transaction went to the bridge inbox
with `input 0x439370b1` (the Arbitrum Orbit `depositEth()` call) and arrived in about one minute.

```bash
cast balance YOUR_WALLET --rpc-url https://testnet-rpc.elysium.kinetiq.xyz --ether
# 0.2341
```

### Step 7. Send it to the deploy wallet

1. In the wallet, switch to **Elysium Testnet** (chain 99801).
2. Send about **0.2 HYPE** from `YOUR_WALLET` to `DEPLOYER`.
3. Confirm the network line in the wallet prompt says Elysium Testnet, not HyperEVM.

```bash
cast balance DEPLOYER --rpc-url https://testnet-rpc.elysium.kinetiq.xyz --ether
# about 0.2
```

With that balance the 15-contract deploy (estimated at 0.0126 HYPE) and the rehearsal steps after it have plenty of
room. The deploy itself is in `docs/elysium-testnet.md`.

## 8. Pitfalls and troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| HYPE sent to `0x2222...2222`, HyperCore balance empty, role `missing` | The account does not exist yet. The HYPE is held under `evmEscrows`. Activate the account with step 2 and the escrow is released into spot. No fund is lost |
| The drip button says "Already claimed" or is grey | Trust the API, not the label. Check `userRole` (must be `user`), then `clearinghouseState`. Refresh after a minute |
| Trade page shows Long / Short and 10x | That is the perp. Use the Spot tab of the market selector, or open `/trade/@1035` |
| Limit order did not fill | The ask moved. Read `l2Book` again and place a new limit above the current best ask. Cancel the old one from Open Orders so funds are released |
| Order Value looks much bigger than expected | It shows the ceiling (price x size), not the fill. The fill happens at the best ask |
| Deposit to a new account of 1 USDC or less | Fails silently. Deposit more than 1 USDC |
| Balance reads `20.0000` and looks like twenty thousand | A dot is a decimal point. It is twenty |
| "You're sending to a contract, funds may be lost" in the wallet | Expected for the system address and the bridge inbox. Keep the amount small the first time |
| Bridge arrived but the deployer shows 0 | The bridge pays the sending wallet. Do step 7 |
| Wallet says insufficient gas on HyperEVM testnet | Keep a few thousandths of HYPE there. The system address and bridge calls need gas |
| A faucet says it is "empty" but you pass its checks | Not your fault. Try later or use this route |

Faucet policies change often. Re-check each address on-chain and each rule on the faucet's own page before relying on
this guide a second time.

## 9. Final state, safety, API cheat sheet, glossary

Where the funds ended up:

| Place | Amount |
| --- | --- |
| Elysium testnet, funded wallet | 0.2341 HYPE (before the send to the deploy wallet) |
| HyperEVM testnet, funded wallet | about 0.005 HYPE |
| HyperCore testnet spot | about 17 USDC and 0.0008 HYPE |
| HyperCore mainnet spot | about 2 USDC and 0.01 HYPE |

The mainnet leftovers can go back to HyperEVM with **Transfer to EVM** on `app.hyperliquid.xyz` whenever you want them.

Safety rules:

- One wallet, signed only inside your wallet extension. No private key goes to any site.
- Check the destination network and address in every wallet prompt before confirming.
- Start small the first time you touch a system address. Verify the result with the API before repeating.
- Do not treat testnet prices as real prices.

API cheat sheet (`POST` to `https://api.hyperliquid.xyz/info` for mainnet, `https://api.hyperliquid-testnet.xyz/info`
for testnet):

| Question | Request body |
| --- | --- |
| Is the account active? | `{"type":"userRole","user":"ADDR"}` |
| Spot balances and escrow | `{"type":"spotClearinghouseState","user":"ADDR"}` |
| Perps balance | `{"type":"clearinghouseState","user":"ADDR"}` |
| Open orders | `{"type":"openOrders","user":"ADDR"}` |
| Fills | `{"type":"userFills","user":"ADDR"}` |
| Order book of the spot market | `{"type":"l2Book","coin":"@1035"}` |
| Deposits and transfers | `{"type":"userNonFundingLedgerUpdates","user":"ADDR","startTime":0}` |

Glossary:

| Term | Meaning |
| --- | --- |
| HyperEVM | The EVM side of Hyperliquid. Chain 999 (mainnet) and 998 (testnet). Gas is HYPE |
| HyperCore | The trading side: perps and spot order books, with its own accounts |
| Escrow | Funds held for an address whose HyperCore account does not exist yet. Released on activation |
| CoreDepositWallet | Circle's contract that moves native USDC from HyperEVM into a HyperCore account |
| Perp vs spot | A perp is a leveraged bet on a price and gives no token. Spot trades the real token |
| Limit order | An order with a price ceiling (buy) or floor (sell). It fills only at that price or better |
| Elysium | Kinetiq's Arbitrum Orbit L2 on Hyperliquid. Testnet chain 99801, gas in HYPE |

---

Prepared by **Asif** for the BELL project, 7 November 2026. Testnet only. No keys or credentials appear in this document.
