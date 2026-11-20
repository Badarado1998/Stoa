# Stoa AI for projects

Give your community an assistant that answers about your token from on-chain data: its [safety check](check-token-robinhood-chain.md), price, liquidity, holders and quotes, in any language. Free while in beta, on Robinhood Chain.

## On your website

Add one line before `</body>`:

```html
<script src="https://stoadex.com/stoa-ai.js" data-token="0xYourToken" defer></script>
```

A round Stoa AI button appears at the bottom right and opens the assistant in a small window. Options: `data-ref="0xYourWallet"` adds your [referral](referrals.md) to its Buy button, `data-side="left"` moves the button.

Or put it in an iframe yourself:

```html
<iframe src="https://stoadex.com/embed/ai?token=0xYourToken" width="380" height="600" style="border:0;border-radius:16px"></iframe>
```

## In your Telegram group

1. Add the Stoa AI bot to your group.
2. As a group admin, send `/settoken 0xYourToken`.

From then on "the token" means yours in that group. Members ask with `/ask`, by mentioning the bot, or by replying to it. `/cleartoken` turns it back into a general Robinhood Chain assistant.

## What it says, and what it will not

- It answers from the chain and market data only. It does not know your plans, roadmap or promises, and says your own channels are where to ask.
- It never hypes the token, predicts its price, or calls it safe beyond what the safety check found. If the check says "danger", it says so, in your widget too.
- It reads only and never connects a wallet: Buy opens Stoa in a new tab, where the buyer's own wallet signs.
- Your token's name and symbol are treated as data, so they cannot change what the assistant does.

Each visitor gets 10 free questions a day. Not financial advice.
