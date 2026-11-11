# Risks and safeguards

What can go wrong, and what limits it.

| Risk | Safeguard |
| --- | --- |
| A contract bug affects pool funds | Per-pool and per-swap caps at launch; audit before caps rise |
| A maker loses money in a fast market | Daily loss limits, spreads that widen with volatility, emergency stop |
| A stale price is used | Quotes expire after 2 blocks; pools reject expired quotes |
| No maker quote available | The router fills on Uniswap |
| Thin Uniswap pool for a small token | Price impact is shown before you sign; your slippage limit reverts bad fills |
| HyperCore upgrade is delayed | Makers keep using the Hyperliquid API until it ships |
