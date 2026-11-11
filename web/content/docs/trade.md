# Trade

Swap tokens at maker prices.

1. Open [Trade](https://stoa.trade/trade) and connect a wallet on Elysium (chain 99901).
2. Pick the token to sell and the token to buy. Native HYPE works directly; the router wraps and unwraps it for you.
3. Enter an amount. The router fetches quotes from Stoa maker pools and Uniswap.
4. Check the rate, route and slippage, then confirm in your wallet.

## Slippage

Choose 0.1%, 0.5% or 1%. If the fill would be worse than your limit, the swap reverts.

{% hint style="warning" %}

Maker pools cap each fill at **$500** while they ramp up. Larger swaps fill on Uniswap, where price impact depends on the pool's depth.

{% endhint %}
