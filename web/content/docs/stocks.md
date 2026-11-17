# Stock tokens

[Stocks](https://stoadex.com/stocks) lists every Robinhood Stock Token on Robinhood Chain, with two prices side by side and a swap on Stoa where one exists.

Stock Tokens are ERC-20 tokens issued by Robinhood Assets (Jersey) Limited, not by Stoa, and they are not offered in every country: check Robinhood's terms for yours. Stoa only routes swaps between tokens. Nothing here is investment advice.

## The two prices

- **Robinhood**: the middle of Robinhood's bid and ask for one token, from Robinhood's public Stock Token API. It follows the underlying shares, so it moves while the US market, extended hours or the overnight session is open.
- **On-chain**: what the token trades for in its deepest pool on Robinhood Chain (as DexScreener lists it), and how far that is from Robinhood's price.

The badge at the top shows the US session right now: open (9:30 to 16:00 New York time), extended hours, the overnight session, or closed (weekends and market holidays). The tokens can trade on-chain at any time; outside the sessions their pools have no live reference price, so the gap between the two prices can grow.

## Swapping a stock token

**Swap** appears when Stoa's router can buy the token with 100 USDG right now. It opens [Trade](trade.md) with USDG to sell and the stock token to buy, because most stock token pools pair them with USDG. Trade then quotes your exact amount across every venue, as for any other token.

Tokens without Swap have no pool Stoa can use yet. Every day Stoa's keeper looks for Uniswap V4 pools of Robinhood's listed Stock Tokens and adds the ones that are deep enough and old enough to the V4 adapter, so the list of tokens with Swap grows on its own. It never replaces a pool that is already there.

## Watchlist and price alerts

- Tap ☆ on Stocks, on a token page or next to the token you buy on Trade. Your watchlist shows on [Portfolio](portfolio.md) and as one-tap chips above the swap form.
- On any watched token, **Alert** sets a price. The alert fires once, when the on-chain price reaches it, as a message on the page and, if you allow it, a notification on your phone or computer.
- Alerts are checked every minute **while Stoa is open** in a tab or as the installed app. Stoa has no server that watches prices for you.
- The watchlist and alerts are saved in your browser only. There is no account and nothing is sent to Stoa; another browser or device has its own list.

## For apps

[stoadex.com/api/v1/stocks](https://stoadex.com/api/v1/stocks) returns the same list as JSON: each token's address, Robinhood's price, its deepest on-chain pool and whether Stoa routes it. It updates every couple of minutes. See [API for bots and apps](api.md).
