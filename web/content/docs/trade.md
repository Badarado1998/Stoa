# Trade

Swap tokens at maker prices.

1. Open [Trade](https://stoa.trade/trade) and connect a wallet on Elysium (chain 99901).
2. Pick the token to sell and the token to buy. Native HYPE works directly; the router wraps and unwraps it for you.
3. Enter an amount. The router fetches quotes from Stoa maker pools and Uniswap.
4. Check the rate, route and slippage, then confirm in your wallet.

## Slippage

Choose 0.1%, 0.5% or 1%. If the fill would be worse than your limit, the swap reverts.

## Approvals and safety checks

- Selling an ERC-20 for the first time asks for an approval of **only that amount**. You can opt in to an unlimited approval in settings.
- **Price impact** is shown for every swap. Above 3% it is highlighted; above 15% you must confirm.
- Tokens you import by address are **unverified**. Check the address before you trade.

{% hint style="warning" %}

Maker pools cap each fill at **$500** while they ramp up. Larger swaps fill on Uniswap, where price impact depends on the pool's depth.

{% endhint %}
