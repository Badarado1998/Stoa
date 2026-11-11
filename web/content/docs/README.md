# Introduction

Stoa is the PropAMM hub on Elysium: pools priced live by professional makers, with every swap checked against other venues before you sign.

## What Stoa is

Most AMMs price a trade with a fixed formula. On Stoa, every pool is priced by **makers** who post bid and ask quotes on-chain, block after block. That is called a proactive AMM, or PropAMM. Because Elysium produces a block every 100–200 ms, makers can update prices several times a second at low cost.

## Who it is for

| You are | What you do on Stoa |
| --- | --- |
| Trader | Swap at the best price across Stoa maker pools and Uniswap on Elysium. |
| Liquidity provider | Deposit into a pool vault and hold ERC-4626 shares that grow with fees. |
| Curator / maker | Run a pool: bring a price source, post a HYPE bond, quote every block. |
| Builder | Use the router, SDK and LP tokens inside your own app or contract. |

## Key facts

| Item | Value |
| --- | --- |
| Network | Elysium (Hyperliquid L2 by Kinetiq), chain ID 99901 |
| First pool | WHYPE / USDC |
| Protocol fee | 2 bps per swap |
| Quote validity | 2 blocks |
| Launch limit | $500 per swap |

## How Stoa launches

Stoa launches **router first**. On day one every swap is checked against Uniswap on Elysium and filled there, so trading works before any maker pool holds inventory. Maker pools join the same router as curators come online, and win whenever they quote a better price. Nothing changes for you as a trader.

{% hint style="info" %}

Stoa is not live yet. Pages marked **at launch** describe how things will work when the contracts are deployed.

{% endhint %}
