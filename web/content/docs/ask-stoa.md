# Ask Stoa (AI)

[Ask Stoa](https://stoadex.com/ai) is an assistant for Robinhood Chain. Ask in plain words, in any language:

- "Swap 0.01 ETH to USDG": it quotes through Stoa's router (about how much, at least how much, price impact, route) and, when you want to go ahead, prepares the swap as a card. **You sign it in your own wallet.** Nothing happens until you do.
- "Is this token safe?": Stoa's [safety check](check-token-robinhood-chain.md) explained in plain words: whether a test buy and sell-back work, taxes, the creator's share.
- "How far is NVDA from Robinhood's price?": stock tokens next to Robinhood's price.
- "Who is in Spotlight this week?", and questions about Stoa answered from these docs.
- "Make me a payment link for 25 USDG": a [Stoa Pay](stoa-pay.md) link, ready to share.
- "Buy NVDA with 50 USDG if it drops 5%" or "Sell 1000 STOA for ETH if it goes up 20%": a [limit order](limit-orders.md) built from your words, shown as a card you sign. Your deposit waits in Stoa's limit order contract and Stoa's keeper fills it once the market pays that price. A limit order only fills at a better price than now, so it cannot be a stop-loss.
- "Scan my tokens for rug signs": a rug scan of your connected wallet (see below).
- "Add NVDA and STOA to my watchlist": it keeps your watchlist (the same one as the star on Trade and token pages, kept in your browser) and opens with it next time.
- "Lock all my STOA for Spotlight" or "Vote for 0x… with all my STOA": a [Spotlight](spotlight.md) card you sign. Votes you already gave other candidates this week stay on the card.

## Rug scan and alerts

The rug scan looks at your tokens other than ETH, WETH, USDG and stock tokens, and flags what it sees right now: a "danger" safety verdict, a test sell that fails, the creator's wallet sending out more than 1% of supply in the last 6 hours (Pons launches), the price falling 30% or more in an hour, or very little liquidity left. These are signals, not certainty: a creator moving tokens can have an ordinary reason.

To get alerts, message the Stoa AI Telegram bot privately: `/watch 0xYourWallet` (your public address only). It scans every 10 minutes and messages you about each new sign, at most once a day per token and sign. `/unwatch` stops it. Alerts never sell anything for you.

## In Telegram

The Stoa AI bot answers in private chats, and in groups when you use `/ask`, mention it, or reply to it. It reads only: for a swap, a limit order or a payment it sends you to stoadex.com/ai, where your own wallet signs. Projects can make it their own assistant: see [Stoa AI for projects](stoa-ai-for-projects.md).

Quick data, free and unlimited: `/price STOA`, `/gaps` (stock tokens against Robinhood's price), `/pnl 0xWallet` (swaps through Stoa), `/top` (the [Points](points.md) board), `/watchlist add NVDA STOA`. A group admin can send `/report on` for a short market report in the group at 01:00 and 13:00 UTC (on Mondays with last week on Stoa and the Points top 5), with Spotlight reminders when a week opens and before bids and votes close.

Price alerts, in a private chat: `/alert NVDA below 120`, `/alert STOA up 20%`. The bot checks every 5 minutes and messages you once; `/alerts` lists them, `/unalert` removes one. Up to 10 at a time.

The bot's **Open Stoa** menu button (and `/app`) opens Stoa inside Telegram: swap, Stoa AI and Stoa Pay, signed by your own wallet.

## What it will not do

- Sign, send or hold anything. Every swap is built for your connected wallet and checked again in your browser before your wallet opens: it must go through Stoa's router and pay the wallet that signs.
- Tell you what to buy. It explains data; it is not financial advice.
- Ask for a private key or seed phrase. Nothing on Stoa ever needs them.

Before preparing a buy of a token other than ETH, WETH, USDG or a Robinhood stock token, it runs the safety check, and it warns you plainly when the verdict is "danger".

## Limits and credits

10 free messages a day on the site, and 10 a day in Telegram. When they run out, buy more from your connected wallet on Robinhood Chain: a pack of 50 messages costs 1 USDG, or the same value in ETH or $STOA. USDG and ETH go to Stoa's Safe; **$STOA is sent to the burn address**, so paying in $STOA takes it out of supply for good. Credits belong to your wallet and never expire. The payment is checked on-chain and counted once. The assistant runs on a third-party AI model through OpenRouter; what you type is sent there to get an answer, with your connected address but nothing else. It can be wrong: check the card before you sign.
