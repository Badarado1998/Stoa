# Trade

Swap tokens on Robinhood Chain or Elysium, on the best route Stoa finds across the venues it uses.

1. Open [Trade](https://stoadex.com/trade) and pick a network with the button at the top right: **Elysium** (chain 99901) or **Robinhood Chain** (chain 4663). A first visit opens on Robinhood Chain; if your wallet is already on one of them, the app follows it. A direct link to Robinhood Chain: [stoadex.com/trade?chain=robinhood](https://stoadex.com/trade?chain=robinhood).
2. Pick the token to sell and the token to buy. The native coin works directly (HYPE on Elysium, ETH on Robinhood Chain); the router wraps and unwraps it for you.
3. Enter an amount. The router compares every venue it uses on that network, directly and through the wrapped native token (WHYPE or WETH), and shows the route it found.
4. Check the rate, route and slippage, then confirm in your wallet.

| Network | Venues checked on every swap |
| --- | --- |
| Elysium | Stoa maker pools, Uniswap V2/V3/V4, Aero, Ramses, Liquidity Book |
| Robinhood Chain | Uniswap V2, V3 and V4, including Pons launch pools; Pons bonding curves once the admin Safe has added them |

## Safety check

When you buy an unverified token, Trade runs a safety check first. It simulates buying a small amount through the live router and selling it straight back, on the chain as it is now, without sending anything. It reports:

- whether the test sell worked: a token you cannot sell back is the classic honeypot;
- any tax the token takes that its quote does not show, on the buy and on the sell;
- what buying and selling back at once costs, pool fees and price impact included;
- how much of the supply the creator's wallet holds (Pons launches) and the ten largest wallets hold (Robinhood Chain).

A pass means the token behaves today. Its owner can still change what the token allows later, so trade only what you can afford to lose. Each Pons token's page on Launches shows the same check.

## Limit orders

On Robinhood Chain, the **Limit** tab sells at a price you set instead of the price right now. See [Limit orders](limit-orders.md).

## Slippage

Choose 0.1%, 0.5% or 1%. If the fill would be worse than your limit, the swap reverts.

## Approvals and safety checks

- Selling an ERC-20 for the first time asks for an approval of **only that amount**. You can opt in to an unlimited approval in settings.
- **Price impact** is shown for every swap. Above 3% it is highlighted; above 15% you must confirm.
- Token labels in the picker:
  - **✓ bridged from HyperEVM**: major tokens (KNTQ, kHYPE, USD₮0, UBTC, UETH, PURR) that came through Elysium's canonical bridge. Stoa checked on-chain that each address is the bridge's own copy of the HyperEVM token.
  - **Bridged from HyperEVM**: other tokens from the same bridge that Stoa can trade both ways, refreshed daily. Anyone can bridge any HyperEVM token, so these still show the token warning.
  - **Montra launch / PerpMe launch / Pons launch**: created by that launchpad, checked from its public token list, its verified factory contract or its launch pool. This says where the token came from, not that it is safe.
  - **Official Stoa token**: $STOA on Robinhood Chain, read on-chain from the dev wallet's launch on Pons. It is the only STOA marked this way.
  - **Unverified**: anything else, including tokens you import by address. Check the address before you trade.

{% hint style="warning" %}

On Elysium, maker pools cap each fill at **$500** while they ramp up. Larger swaps fill on the deepest outside venue, where price impact depends on that pool's depth.

{% endhint %}

## Tokens on Uniswap V4

Most launchpad tokens on Elysium and Robinhood Chain trade in Uniswap V4 pools, which the router cannot discover by itself. Stoa's keeper registers the most traded ones every day, and Pons graduation pools usually within the hour. Only the keeper adds pools, and only pools whose hooks are on Stoa's allowlist. If the router has no route for a token you imported, the swap screen says whether it trades in a Uniswap V4 pool the router does not use yet.

## Tokens still on a bonding curve

A Pons token trades on its own bonding curve until it graduates to a Uniswap V4 pool ([Trade Pons tokens](trade-pons.md) has the details). Stoa's Pons curve adapter (live since 18 November 2026) trades on the curve directly: ETH for the token and back, or any other token through WETH. A curve trade pays Pons' 1% fee and the token's creator tax on top of Stoa's 2 bps, so the swap screen's price already includes them. The one buy it leaves to Pons is the buy that would graduate the curve. After graduation the token's V4 pool takes over: Stoa's keeper registers that pool on the router, usually within the hour.

## Pools on Robinhood Chain

[Pools](https://stoadex.com/pools?chain=robinhood) lists the most liquid pools the router checks on Robinhood Chain: Uniswap V2 and V3 pools from the official factories, Uniswap V4 pools registered in Stoa's adapter and, once the admin Safe has added them to the router, Aero and Ramses pools. Liquidity and 24-hour volume come from DexScreener and are for display only; a swap always uses the on-chain quote.

## Links to a pair

A swap link can pick the network and both tokens: `stoadex.com/trade?chain=robinhood&sell=ETH&buy=0x…`. `sell` and `buy` take a ticker from the list or a token address. A token that is not on the list is imported by address and shows the unverified-token check before you can swap.
