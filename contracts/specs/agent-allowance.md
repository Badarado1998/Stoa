# Spec: Agent Allowance (draft for review)

Status: **draft, not built, not deployed.** It needs an independent security review (HEY) and the owner's yes before any code is deployed. Nothing here changes the router.

## Why

Stoa AI and outside AI agents can already build swaps, but a person has to sign every one. An allowance lets a person give one agent a narrow, revocable permission: "this agent may swap up to 50 USDG a day into NVDA or TSLA, paid to me, for 30 days." It is also what per-call payments in the planned agent marketplace need ("this agent may pay up to 2 USDG a day to these service addresses").

## Shape

One contract, `StoaAllowance`, non-custodial: funds stay in the person's wallet until the moment of a swap or payment. The person approves tokens to the contract (exact amounts or Permit2), then creates **grants**.

```
struct Grant {
  address owner;        // the person; every swap pays out to them, always
  address agent;        // the only address that can use this grant
  uint8   kind;         // SWAP or PAY
  address tokenIn;      // what may be spent
  uint96  perTx;        // max tokenIn per use
  uint96  perDay;       // max tokenIn per rolling 24 hours
  uint32  maxUsesPerDay;
  uint16  maxSlippageBps; // SWAP: minOut must be within this of router.quote at execution
  uint64  expiry;       // at most 90 days out
  bool    revoked;
}
mapping(uint256 => address[]) allowedOut;  // SWAP: the tokens it may buy (non-empty, max 10)
mapping(uint256 => address[]) allowedTo;   // PAY: the addresses it may pay (non-empty, max 10)
```

Calls:

- `grant(...)`, `revoke(id)`, `revokeAll()`: the owner only. Revoke works even while paused.
- `swapFor(id, tokenOut, amountIn, minOut, mid, leg1, leg2)`: the grant's agent only. Checks kind, expiry, `tokenOut` in `allowedOut`, `amountIn <= perTx`, the rolling day total and use count, and `minOut >= quote * (10_000 - maxSlippageBps) / 10_000` with `quote` from `router.quote(tokenIn, tokenOut, amountIn)` in the same call. Pulls `amountIn` from the owner and calls the router with `to = owner`. The agent can never be the recipient.
- `payFor(id, to, amount)`: the grant's agent only. Checks kind, expiry, `to` in `allowedTo`, the caps. Transfers from the owner straight to `to`.
- Guardian `pause()`; owner functions behind the existing 48-hour timelock and 2-of-3 Safe. No upgrade path, no admin path to anyone's funds.

Events for every grant, use and revoke, so Stoa AI can show "what my agents did today".

## Risks and what limits them

1. **A bad or hacked agent trades badly on purpose.** It can push a pool in the same block and then swap the owner's funds into it, so the slippage check against `router.quote` alone does not stop it. Limits: `perTx`, `perDay` and `maxUsesPerDay`; `allowedOut` is chosen by the owner (the app suggests only liquid tokens: USDG, WETH, stock tokens); the app shows a plain "the most you can lose in a day is about X" line. **Question for review:** is a same-block price check (for example comparing the quote with the pool's price at the start of the block, or a short TWAP where one exists) worth its cost here?
2. **Approval left behind.** The approval to the contract outlives the grant. Revoke does not touch it; the app shows it and offers to set it to zero. The contract can only use it through a live grant.
3. **Fee-on-transfer and rebasing tokens.** Refused for `tokenIn`, as in `StoaLimit` (balance-difference check).
4. **Many grants per owner.** A cap (for example 20 live grants) keeps loops bounded.
5. **Paying from the wrong grant.** `payFor` and `swapFor` check `kind`; a PAY grant can never swap and the reverse.

## What the app does

Stoa AI builds the grant card in plain words ("Let this agent swap up to 50 USDG a day into NVDA or TSLA for 30 days") and the person signs it. A page lists live grants with one-tap revoke. Agents use it through the public API and MCP tools; Stoa AI itself would hold no key.

## Open questions for review

- Same-block price manipulation (risk 1).
- Should `perDay` be counted in the token or in USD? Token units need no oracle; USD would need one.
- Should grants be EIP-712 signed messages instead of transactions, so creating one costs no gas?
