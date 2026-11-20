# Ask Stoa (AI)

[Ask Stoa](https://stoadex.com/ai) is an assistant for Robinhood Chain. Ask in plain words, in any language:

- "Swap 0.01 ETH to USDG": it quotes through Stoa's router (about how much, at least how much, price impact, route) and, when you want to go ahead, prepares the swap as a card. **You sign it in your own wallet.** Nothing happens until you do.
- "Is this token safe?": Stoa's [safety check](check-token-robinhood-chain.md) explained in plain words: whether a test buy and sell-back work, taxes, the creator's share.
- "How far is NVDA from Robinhood's price?": stock tokens next to Robinhood's price.
- "Who is in Spotlight this week?", and questions about Stoa answered from these docs.
- "Make me a payment link for 25 USDG": a [Stoa Pay](stoa-pay.md) link, ready to share.

## What it will not do

- Sign, send or hold anything. Every swap is built for your connected wallet and checked again in your browser before your wallet opens: it must go through Stoa's router and pay the wallet that signs.
- Tell you what to buy. It explains data; it is not financial advice.
- Ask for a private key or seed phrase. Nothing on Stoa ever needs them.

Before preparing a buy of a token other than ETH, WETH, USDG or a Robinhood stock token, it runs the safety check, and it warns you plainly when the verdict is "danger".

## Limits

10 free messages a day. The assistant runs on a third-party AI model through OpenRouter; what you type is sent there to get an answer, with your connected address but nothing else. It can be wrong: check the card before you sign.
