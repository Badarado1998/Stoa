# Spec: Anti-rug autopilot (draft for review)

Status: **draft, not built, not deployed.** It needs an independent security review (HEY) and the owner's yes before any code is deployed. Nothing here changes the router.

Revision 2 (22 Nov 2026) folds in the design notes from the independent security review of 21 Nov. What changed is listed at the end.

## Why

Today Stoa AI scans a wallet for rug signs and the Telegram bot sends alerts, but a person still has to wake up and sell. The autopilot sells a token for them when a rug sign that **the chain itself can show** appears, at a floor they chose.

## What the chain can and cannot prove

Balances alone cannot prove that a creator *sold*. When the creator's balance drops, the tokens may have gone to:

- a pool (a sale);
- a second wallet;
- a burn;
- a lock;
- an LP position.

What the chain can show is the **effect of a sale**: the pool's quote-side reserve (ETH or USDG) and the price are lower than a reference recorded earlier. Version 1 therefore fires on two conditions together:

1. the creator's balance fell by at least `creatorDropBps` of a checkpoint;
2. the token's main pool lost at least `poolDropBps` of its quote-side depth or price against a checkpoint.

Both must stay true across a delay.

## Shape

One contract, `StoaRugGuard`, non-custodial: the token stays in the person's wallet until a sale. The person approves the token to the contract and creates a **guard**. Guards on the same token share one **watch**.

```
struct Watch {                // one per token
  address token;
  address creator;            // from the factory record only (Pons getLaunchedToken), never set by hand
  address pool;               // the token's main pool (Pons curve or Uniswap V4/V3 pool)
  uint96  creatorCheck;       // creator balance at the last keeper checkpoint (an earlier block)
  uint128 depthCheck;         // pool's quote-side depth (ETH or USDG) at that checkpoint
  uint64  checkBlock;
  uint64  armedAt;            // 0 = not armed
}
struct Guard {
  address owner;
  address token;
  address sellTo;             // ETH or USDG only
  uint96  amount;             // how much to sell when it fires (capped by balance and approval)
  uint96  minOutPerToken;     // the owner's floor, as a price
  uint16  creatorDropBps;     // e.g. 2000 = creator balance down 20% from the checkpoint
  uint16  poolDropBps;        // e.g. 2500 = pool's quote side or price down 25% from the checkpoint
  uint64  expiry;             // at most 90 days out
  bool    done;
}
```

### Who can be watched

A token can be watched only if:

- its creator comes from the factory record;
- the creator is a plain wallet, not a contract or a known launch service or locker;
- the creator held at least about 1% of supply at the first checkpoint.

Otherwise the app keeps the token on alerts only. This stops guards that fire when a launchpad or locker moves tokens.

### Calls

- `guard(...)`, `cancel(id)`: the owner only. Cancel works while paused.
- `checkpoint(token)`: the keeper records the creator's balance and the pool's depth and price in a block. The guard compares against the last checkpoint, never against the moment the guard was made, so a creator cannot game the snapshot by moving tokens just before guards are created.
- `arm(token)`: the keeper or any guard owner. It succeeds only if both conditions are true now against the checkpoint, and it records `armedAt`.
- `fire(token, mid, leg1, leg2)`: the keeper or any guard owner, at least `ARM_DELAY` (for example 2 blocks and 30 seconds) after `armedAt`. Both conditions must still be true. If either is false the watch disarms, so a creator who briefly moves tokens and moves them back fires nothing.

  Firing sells **every live guard on that token as one pro-rata swap at one price**: the contract pulls each owner's `amount`, does one swap through the router, and splits the output by amount. The floor is the highest `minOutPerToken` of the guards included. Guards whose floor the price cannot meet are left out and stay open; they are not sold below their floor. Each owner's share goes straight to the owner.
- Guardian `pause()`. Owner functions sit behind the existing timelock and Safe.

### Liquidity trigger

The safer trigger is sellable depth alone: what a fixed-size sale of the token would return, falling by `poolDropBps`, confirmed across several blocks. It catches liquidity pulls that the creator-balance trigger misses. Version 1 should offer it on its own (a "liquidity guard") as well as combined with the creator drop.

## Risks and what limits them

1. **The creator moves tokens for an ordinary reason** (a vesting or lock contract, a burn, adding liquidity). The pool-side condition is not met, so nothing fires.
2. **The creator sells through many wallets.** The creator-balance trigger only sees the one wallet, but the pool-side and liquidity triggers see the sale. The app says this plainly.
3. **Selling into a crash.** By the time the trigger is true, the price may already be down. The floor stops a sale below the owner's price; that guard simply stays open.
4. **A creator triggers guards on purpose to buy back cheap.** The creator now has to really drain the pool, and keep it drained across the arm-to-fire delay. All guards sell in one swap at one price with a floor, so there is no line of guarded holders to pick off one by one.
5. **Keeper misses it or is slow.** Any guard owner can call `checkpoint`, `arm` and `fire`, and can always sell normally.
6. **Fee-on-transfer and blocked sells.** Most rugs that block selling would make the swap revert. The guard then fails safely and stays open.

## Open questions for review

- `ARM_DELAY`: what length is long enough to stop a same-block or two-block push, but short enough to still matter in a real rug?
- Checkpoint cadence: how often should the keeper checkpoint, and should a checkpoint older than X refuse to arm?
- The pro-rata swap: is excluding guards whose floor the price cannot meet the right rule, or should the swap be split into floor bands?

## Changes in revision 2 (from the review's design notes)

- The trigger is the effect of a sale (the pool's quote side or price down against an earlier reference) plus the creator's balance drop, armed and then fired across a delay. Burns, locks and LP adds no longer fire it.
- Guards on one token fire as one pro-rata swap at one price, with a real floor.
- `creatorSnap` becomes a keeper checkpoint from an earlier block, not the balance when the guard was made.
- The creator comes only from the factory record. Contracts, launch services and holders of under about 1% of supply are refused.
- A liquidity trigger (sellable depth, confirmed across blocks) is added and described as the safer one.
