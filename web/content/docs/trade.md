# Trade

Swap tokens at maker prices.

1. Open [Trade](https://stoadex.com/trade) and connect a wallet on Elysium (chain 99901).
2. Pick the token to sell and the token to buy. Native HYPE works directly; the router wraps and unwraps it for you.
3. Enter an amount. The router compares Stoa maker pools and Uniswap, directly and through WHYPE, and shows the route it found.
4. Check the rate, route and slippage, then confirm in your wallet.

## Slippage

Choose 0.1%, 0.5% or 1%. If the fill would be worse than your limit, the swap reverts.

## Approvals and safety checks

- Selling an ERC-20 for the first time asks for an approval of **only that amount**. You can opt in to an unlimited approval in settings.
- **Price impact** is shown for every swap. Above 3% it is highlighted; above 15% you must confirm.
- Token labels in the picker:
  - **✓ bridged from HyperEVM**: major tokens (KNTQ, kHYPE, USD₮0, UBTC, UETH, PURR) that came through Elysium's canonical bridge. Stoa checked on-chain that each address is the bridge's own copy of the HyperEVM token.
  - **Bridged from HyperEVM**: other tokens from the same bridge that Stoa can trade both ways, refreshed daily. Anyone can bridge any HyperEVM token, so these still show the token warning.
  - **Montra launch**: launched on Montra. This says where the token came from, not that it is safe.
  - **Unverified**: anything else, including tokens you import by address. Check the address before you trade.

{% hint style="warning" %}

Maker pools cap each fill at **$500** while they ramp up. Larger swaps fill on the deepest outside venue, where price impact depends on that pool's depth.

{% endhint %}

## Tokens on Uniswap V4

Most launchpad tokens on Elysium trade in Uniswap V4 pools, which cannot be discovered on-chain. If the router has no route for a token you imported, the swap screen looks up its V4 pool and offers **Add Uniswap V4 pool**: a one-time transaction anyone can send that lets the router use that pool for everyone. Only pools whose hooks are on Stoa's allowlist can be added.
