# Stoa Pay

Ask to be paid on Robinhood Chain with a link. Whoever opens it can pay with what they hold: USDG, ETH, a stock token or any token Stoa routes on Robinhood Chain, or ETH on Base, Arbitrum, Optimism or Ethereum. You receive USDG, or a Robinhood stock token if you pick one. The link shows when it is paid, with a receipt anyone can check on-chain.

Open [stoadex.com/pay](https://stoadex.com/pay).

## Ask for a payment

1. Enter the wallet that should receive the payment (connect your wallet to fill it in), the amount in USDG (up to 10,000) and, if you like, a short note such as "Logo design".
2. Pick what you receive: USDG, or a Robinhood stock token such as NVDA. With a stock token you get what the amount buys of it when they pay, at least 99.5% of that; you carry the stock's price from then on. Stock Tokens are issued by Robinhood and not offered in every country.
3. Copy the link, share it, or show the QR code.
4. Open the link any time: it says **Paid** once the payment lands, with a link to the receipt.

Nothing is stored. The link itself is the request: it carries your address, the amount, the payout token, the note, a random request id and the block it was made at. Every payment Stoa builds for it ends with that id, which is how the link knows it has been paid. Anyone with the link can pay you; it never lets anyone take funds from you.

## Pay a request

Open the link and check the address with the person who sent it. Stoa does not know who an address belongs to.

**On Robinhood Chain**

- **USDG**: a plain transfer of the amount asked.
- **Any other token**: one swap through Stoa's router, paid straight to the requester. The swap's minimum is the amount asked, so they never get less. If the price moves before it lands so that they would, the swap does not go through and you keep your token. Any extra from the swap goes to them.

**From another chain**

For USDG payouts, pick Base, Arbitrum, Optimism or Ethereum and pay with ETH there. Relay delivers the USDG on Robinhood Chain, usually in under a minute. Before your wallet opens, Stoa checks Relay's order: it must pay exactly the requester at least the amount asked, in USDG, on Robinhood Chain, refund only you, make no other calls and carry no hidden fee. Paying from another chain is limited to 500 USDG per payment for now.

Payments on-chain cannot be reversed.

## Receipts

After paying on Robinhood Chain you get a receipt page (stoadex.com/pay/receipt?tx=…): who paid whom, how much of what, what it was paid with, when, and the request id. It is read from the chain each time, not from Stoa's records, so anyone with the link can check it.

## For apps and AI agents

Stoa's [MCP server](mcp.md) has three tools for this: `create_payment_link`, `pay_payment_link` (an unsigned transaction for the payer's wallet) and `payment_status`. An agent can ask to be paid, pay a link and confirm it was paid, without Stoa holding anything.



A payment link is a URL: `https://stoadex.com/pay?to=0x…&amount=25&note=Logo%20design` (amount in USDG, up to two decimals; the note is plain text up to 80 characters, links are removed). To build the swap yourself, the [HTTP API](api.md) quote takes an optional `recipient`: the swap pays it instead of the taker.
