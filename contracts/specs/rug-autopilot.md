# Spec: Anti-rug autopilot (draft for review)

Status: **draft, not built, not deployed.** It needs an independent security review (HEY) and the owner's yes before any code is deployed. Nothing here changes the router.

## Why

Today Stoa AI scans a wallet for rug signs and the Telegram bot sends alerts, but a person still has to wake up and sell. The autopilot sells a token for them when a rug sign that **the chain itself can prove** appears, at a floor they chose.

## Shape

One contract, `StoaRugGuard`, non-custodial: the token stays in the person's wallet until a sale. The person approves the token to the contract and creates a **guard**:

```
struct Guard {
  address owner;
  address token;        // what to protect
  address sellTo;       // ETH or USDG only
  uint96  amount;       // how much to sell when triggered (or all the owner still holds, capped by the approval)
  uint96  minOut;       // the floor: never sell for less
  address creator;      // read from the Pons factory at creation (getLaunchedToken), or set by the owner
  uint96  creatorSnap;  // creator's balance when the guard was made
  uint16  creatorDropBps; // trigger: creator balance fell by at least this share of creatorSnap (e.g. 2000 = 20%)
  uint64  expiry;       // at most 90 days out
  bool    done;
}
```

Calls:

- `guard(...)`, `cancel(id)`: the owner only. Cancel works while paused.
- `trigger(id, mid, leg1, leg2)`: Stoa's keeper or the owner (not anyone: like `StoaLimit`, a permissionless filler could push the pool to exactly `minOut` and keep the difference). The contract **checks the trigger itself**: `token.balanceOf(creator) <= creatorSnap * (10_000 - creatorDropBps) / 10_000`. If the condition is not true on-chain, the call reverts, so the keeper cannot sell anyone's tokens on a whim. Then it pulls `amount` from the owner and swaps through the router with `to = owner` and the owner's `minOut`.
- Guardian `pause()`; owner functions behind the existing timelock and Safe.

Only provable triggers are in version 1: the creator wallet's balance. Liquidity draining and price crashes stay as alerts (Telegram, Stoa AI), because reading them on-chain safely is harder (see questions).

## Risks and what limits them

1. **The creator moves tokens for an ordinary reason** (to a vesting or lock contract). The guard still fires. The app explains this when the guard is made and suggests a high `creatorDropBps`.
2. **The creator sells through many wallets.** The trigger only sees the one wallet. This is a limit of version 1, said plainly in the app.
3. **Selling into a crash.** By the time the trigger is true the price may already be down; `minOut` stops a sale below the owner's floor (the sale then simply does not happen).
4. **Keeper misses it or is slow.** The owner can always call `trigger` themselves, and can always sell normally.
5. **Fee-on-transfer and blocked sells.** Most rugs that block selling would make the swap revert; the guard then fails safely and stays open.
6. **A creator triggers the guards on purpose.** Moving tokens to a second wallet (no sale) makes the trigger true, the guarded holders sell together, the price drops and the creator buys back cheap. `minOut` bounds each holder's loss, but this is the main open risk: see the first question.

## Open questions for review

- Risk 6: should the trigger require the creator's tokens to have actually left for a pool or a router (a sale), not just any transfer? Can that be proven on-chain at trigger time?
- Can a liquidity trigger (Pons curve reserves, or a Uniswap V4 pool's liquidity) be read on-chain in a way the creator cannot fake in the same block?
- Should `creatorSnap` be refreshable by the owner (for a creator who later buys more)?
- Gas: should one `trigger` be able to fire every guard on the same token in one call?
