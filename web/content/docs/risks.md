# Risks and safeguards

What can go wrong, and what limits it.

| Risk | Safeguard |
| --- | --- |
| A contract bug affects pool funds | Maker pool inventory is supplied by Stoa, not by outside depositors; per-swap caps stay until the audit |
| A venue misbehaves or lies about its output | The router measures what you actually received and reverts below your minimum; it also reverts if a venue does not take exactly your input |
| A malicious venue is added | New venues wait 24 hours in public before they can go live; removals are instant. Uniswap V4 pools can only be added if their hooks are on an allowlist fixed at deployment |
| Something goes wrong | The router can be paused at once by the owner or the guardian |
| The admin key is misused or lost | Admin cannot upgrade code, move funds from your wallet or add a venue without a 24-hour public wait. Ownership is moving to a 2-of-3 Safe multisig (`0xBF71…055F`). See [Admin and permissions](admin.md) |
| A maker posts abusive quotes | Makers must be approved and bond at least 10 HYPE, which can be slashed. Bonds take 24 hours to withdraw, so a maker cannot pull out before a slash |
| Contracts are not externally audited yet | A full [internal review](security-review.md) found no critical or high issues; per-swap cap of $500 on maker pools; vaults stay closed until the external audit |
| Unlimited token approvals | The app approves only the amount of each swap unless you opt in |
| Fake or copycat tokens | Tokens imported by address are marked unverified and need an explicit confirmation |
| Thin pools | Price impact is shown; above 15% you must confirm before swapping |
| A maker loses money in a fast market | Daily loss limits, spreads that widen with volatility, emergency stop |
| A stale price is used | Quotes expire after 2 blocks; pools reject expired quotes |
| No maker quote available | The router fills on the best outside venue (Uniswap, Aero, Ramses or Liquidity Book) |
| Thin pool for a small token | Price impact is shown before you sign; your slippage limit reverts bad fills |
| HyperCore upgrade is delayed | Makers keep using the Hyperliquid API until it ships |
