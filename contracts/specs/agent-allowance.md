# Spec: Agent Allowance (draft for review)

Status: **draft, not built, not deployed.** It needs an independent security review (HEY) and the owner's yes before any code is deployed. Nothing here changes the router.

Revision 2 (22 Nov 2026) folds in the design notes from the independent security review of 21 Nov. What changed is listed at the end.

## Why

Stoa AI and outside AI agents can already build swaps, but a person has to sign every one. An allowance lets a person give one agent a narrow, revocable permission: "this agent may swap up to 50 USDG a day into NVDA or TSLA, paid to me, for 30 days." The planned agent marketplace needs the same thing for per-call payments: "this agent may pay up to 2 USDG a day to these service addresses."

## Shape

One contract, `StoaAllowance`, non-custodial: funds stay in the person's wallet until the moment of a swap or payment. The person approves tokens to the contract (exact amounts or Permit2), then creates **grants**.

```
struct Grant {
  address owner;          // the person; every swap pays out to them, always
  address agent;          // the only address that can use this grant
  uint8   kind;           // SWAP or PAY
  address tokenIn;        // what may be spent
  uint96  perTx;          // max tokenIn per use
  uint96  perDay;         // bucket size: max tokenIn over any 24 hours (leaky bucket, see below)
  uint96  bucket;         // tokenIn used, draining at perDay per 24 hours
  uint64  bucketAt;       // when bucket was last updated
  uint64  lastBlock;      // block of the last use: one use per grant per block
  uint16  maxSlippageBps; // SWAP: minOut must be within this of the reference price
  uint64  expiry;         // at most 90 days out
  bool    revoked;
}
mapping(uint256 => address[]) allowedOut;  // SWAP: the tokens it may buy (non-empty, max 10, each with a reference price)
mapping(uint256 => address[]) allowedTo;   // PAY: the addresses it may pay (non-empty, max 10)
mapping(address => bool) agentFrozen;      // guardian: stops every grant to this agent at once
```

### Calls

- `grant(...)`, `revoke(id)`, `revokeAll()`: the owner only. Revoke works even while paused.
- `swapFor(id, tokenOut, amountIn, minOut)`: the grant's agent only. The checks:
  - the grant's kind, expiry and revoked flag, and that the agent is not frozen;
  - `tokenOut` is in `allowedOut`;
  - `amountIn <= perTx`;
  - the leaky bucket has room;
  - `block.number > lastBlock`;
  - `minOut >= reference(tokenIn, tokenOut, amountIn) * (10_000 - maxSlippageBps) / 10_000`.

  It then pulls `amountIn` from the owner and calls the router. **The contract sets `to = owner` and `referrer = address(0)` itself** and takes the route from `router.quote` in the same call. The agent passes no route, no venue, no recipient and no referrer.
- `payFor(id, to, amount)`: the grant's agent only. It checks the kind, expiry, the freeze, that `to` is in `allowedTo`, `perTx`, the bucket and one use per block. Then it transfers from the owner straight to `to`.
- `freezeAgent(agent)` / `unfreezeAgent(agent)`: the guardian freezes, and only the timelock unfreezes. One transaction stops a leaked agent key that many people have granted. Owners can still revoke while an agent is frozen.
- Guardian `pause()`. Owner functions sit behind the existing 48-hour timelock and the 2-of-3 Safe. There is no upgrade path and no admin path to anyone's funds.

Every grant, use, freeze and revoke emits an event, so Stoa AI can show "what my agents did today".

### The reference price

`router.quote` is read inside the transaction the agent sends, so the agent can move the pool earlier in that same transaction or block and then swap the owner's funds into it. The slippage check therefore uses a price the agent cannot move in that transaction, in this order:

1. a Chainlink-style feed for the pair (stock tokens, WETH, USDG);
2. otherwise a TWAP of at least 30 minutes from a Uniswap V3 or V4 pool with enough depth;
3. otherwise a price Stoa's keeper posted in an earlier block (`postPrice(token, price)`, at most N minutes old). It is used only together with a deviation cap, so a wrong keeper price can only block swaps, never widen them.

A token with no reference price cannot be added to `allowedOut`. The start-of-block price cannot be read on-chain, so it is not an option. Combined with one use per grant per block, this means a manipulated pool has to stay manipulated across blocks and against the reference.

### The daily cap

`perDay` is a leaky bucket in token units. Each use adds `amountIn` to `bucket`, and `bucket` drains at `perDay` per 24 hours. A use is allowed while `bucket + amountIn <= perDay`. A calendar day would allow twice the cap across midnight; the bucket never allows more than `perDay` in any 24 hours. Counting in token units needs no oracle for PAY grants.

## Risks and what limits them

1. **A bad or hacked agent trades badly on purpose.** The reference price, one use per block, `perTx`, the bucket and an `allowedOut` list chosen by the owner bound it. The app shows "the most this agent can spend in a day is X". It suggests only tokens with a feed or a deep TWAP: USDG, WETH and stock tokens.
2. **An agent pays itself.** It cannot choose `to` or `referrer`, so it earns no referral share on the owner's swaps and cannot receive the output.
3. **One leaked agent key across many owners.** `freezeAgent` stops it in one transaction.
4. **Approval left behind.** The approval to the contract outlives the grant, and revoking a grant does not touch it. The app shows it and offers to set it to zero. The contract can only use it through a live grant.
5. **Fee-on-transfer and rebasing tokens.** Refused for `tokenIn`, as in `StoaLimit` (balance-difference check).
6. **Many grants per owner.** A cap (for example 20 live grants) keeps loops bounded.
7. **Paying from the wrong grant.** `payFor` and `swapFor` check `kind`: a PAY grant can never swap, and a SWAP grant can never pay.

### If grants become signed messages (EIP-712)

Signed grants would cost the owner no gas to create, but they need two things:

- an owner nonce, where `revokeAll` bumps the nonce;
- `revokeHash(hash)`, so a grant can be cancelled before its first use, before it is ever seen on-chain.

## What the app does

Stoa AI builds the grant card in plain words ("Let this agent swap up to 50 USDG a day into NVDA or TSLA for 30 days") and the person signs it. A page lists live grants with one-tap revoke. Agents use grants through the public API and MCP tools. Stoa AI itself would hold no key.

## Open questions for review

- Keeper-posted prices: how many minutes old, and what deviation cap against the last TWAP?
- Is one use per grant per block enough, or should it be one per agent per block across all grants?
- Should grants be EIP-712 signed messages from the start (see above)?

## Changes in revision 2 (from the review's design notes)

- The slippage check uses a feed, a 30-minute-plus TWAP or an earlier keeper price instead of `router.quote` in the same transaction. Tokens without one are refused, and each grant allows one use per block.
- `to` and `referrer` are set by the contract, and the agent no longer picks venues.
- A guardian freeze per agent.
- A leaky bucket in token units instead of a calendar day.
- For signed grants: revoke-by-hash and an owner nonce.
