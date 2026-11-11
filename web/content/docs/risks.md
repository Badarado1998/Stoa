# Risks and safeguards

What can go wrong, and what limits it.

| Risk | Safeguard |
| --- | --- |
| A contract bug affects pool funds | Per-pool and per-swap caps at launch; audit before caps rise |
| A venue misbehaves or lies about its output | The router measures what you actually received and reverts below your minimum; it also reverts if a venue does not take exactly your input |
| A malicious venue is added | New venues wait 24 hours in public before they can go live; removals are instant |
| Something goes wrong | The router can be paused at once by the owner or the guardian |
| Unlimited token approvals | The app approves only the amount of each swap unless you opt in |
| Fake or copycat tokens | Tokens imported by address are marked unverified and need an explicit confirmation |
| Thin pools | Price impact is shown; above 15% you must confirm before swapping |
| A maker loses money in a fast market | Daily loss limits, spreads that widen with volatility, emergency stop |
| A stale price is used | Quotes expire after 2 blocks; pools reject expired quotes |
| No maker quote available | The router fills on Uniswap |
| Thin Uniswap pool for a small token | Price impact is shown before you sign; your slippage limit reverts bad fills |
| HyperCore upgrade is delayed | Makers keep using the Hyperliquid API until it ships |
