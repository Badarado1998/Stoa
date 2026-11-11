# How Stoa works

Four parts work together on every swap: makers, pools, the router and you.

Maker posts a quote → Pool stores it → Router compares sources → You get the best fill

## 1. Makers quote

A maker runs a bot that reads a price source and posts a bid, an ask, a size and an expiry to its pool. Quotes refresh whenever the price moves past a threshold, targeting about every 200 ms.

## 2. Pools hold inventory

Each `StoaPool` holds the tokens that fill swaps and only accepts quotes that are still fresh. In the first version, a pool's curator supplies its inventory. Public liquidity vaults come after the contracts are audited.

## 3. The router picks the best fill

`StoaRouter` asks every Stoa pool for a price, compares it with Uniswap V2 and V3 on Elysium (every fee tier, directly or through HYPE for tokens that only trade against HYPE), and routes your swap to the best result in one transaction. If no maker quote is valid, it fills on Uniswap. More venues such as Nest can be added as adapters.

## 4. You sign once

You set a maximum slippage. If the price you get would be worse than that, the transaction reverts and your funds stay in your wallet.
