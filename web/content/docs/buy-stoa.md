# How to buy $STOA

$STOA is Stoa's official token on Robinhood Chain. Contract: `0x13E6993417616De724F2b337D65063f229e96718`. Always check this address: anyone can launch a token called STOA, and only this one is Stoa's. It is also pinned on the [$STOA page](https://stoadex.com/token) and in the footer of every page.

## What you need

- A wallet on **Robinhood Chain** (chain ID 4663). Any EVM wallet works: Stoa adds the network when you connect.
- **ETH on Robinhood Chain**, for the trade and for gas. Gas is a few cents at most.

## Where $STOA trades now

$STOA launched on [Pons](https://ponsfamily.com/launchpad/0x13E6993417616De724F2b337D65063f229e96718) and still trades on its Pons bonding curve. Live progress toward graduation is on the [$STOA page](https://stoadex.com/token).

| When | Where to buy | How |
| --- | --- | --- |
| Until the Pons curve adapter is live (scheduled 18 Nov 2026) | Pons | Open $STOA on Pons and buy with ETH |
| From then, while $STOA is on its curve | Stoa | Swap ETH, or any token Stoa routes, for $STOA. Stoa buys it on the curve |
| After graduation | Stoa | Stoa routes the Uniswap V4 pool Pons creates at graduation |

## Buy on Stoa, step by step

1. Open [stoadex.com/trade?chain=robinhood&buy=0x13E6993417616De724F2b337D65063f229e96718](https://stoadex.com/trade?chain=robinhood&buy=0x13E6993417616De724F2b337D65063f229e96718). The link selects Robinhood Chain and $STOA for you.
2. Connect your wallet. If it is on another network, Stoa asks it to switch.
3. Pick what you pay with: ETH directly, or USDG or another token (Stoa swaps it to WETH first, in the same transaction).
4. Enter the amount and check the details under the quote:
   - **Filled by** says where the swap fills: *Pons curve* before graduation, *Uniswap V4* after.
   - **Curve fees** (curve fills only): Pons' 1% fee plus $STOA's 1.8% creator tax. They are already in the amount you see.
   - **Price impact** and **Minimum received**.
5. Confirm in your wallet. $STOA arrives in the same transaction.

## Costs

| Cost | Size | Goes to |
| --- | --- | --- |
| Stoa protocol fee | 2 bps (0.02%) | Stoa's fee contract: 10% to the referrer if you came through a referral link, the rest buys and burns $STOA every week (from the 17 Nov handover) |
| Pons fee (curve only) | 1% | Pons |
| $STOA creator tax (curve only) | 1.8% | $STOA's creator wallet, as set at launch on Pons |
| Uniswap pool fee (after graduation) | The pool's fee | The pool's liquidity providers |
| Gas | A few cents at most | Robinhood Chain |

## Before you buy

$STOA is a new token with a small market. Its price can fall to zero. Stoa's contracts are source-verified and run behind a 2-of-3 Safe and a 48-hour timelock, but they have not had an external audit. Read [Risks](risks.md) and buy only what you can afford to lose.
