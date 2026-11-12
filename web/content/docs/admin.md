# Admin and permissions

Who controls what in Stoa, and what nobody can do.

## Who holds the keys

| Role | Address | Type |
| --- | --- | --- |
| Owner of every Stoa contract | `0x5A63C75B38e7ee42220Cc3A57702E06D1D8903c9` | Single wallet |
| Guardian (emergency role) | `0x5A63C75B38e7ee42220Cc3A57702E06D1D8903c9` | Same wallet |
| Treasury (receives slashed bonds) | `0xDF129a523aEb072a2CEcbA50170eAb2fcB183C4c` | Wallet |

The owner and guardian are a **single wallet today**, not a multisig. The Safe multisig contracts (v1.3.0) are deployed on Elysium, and moving ownership to a Safe is the next step. This page will list the Safe address and its threshold once the move is done. Ownership uses a two-step transfer: the new owner has to accept, so it cannot be sent to a wrong address by mistake. Any change of owner is an on-chain event anyone can watch.

The wallet that deployed the contracts is separate from the owner and has no admin rights.

## What the owner can do

| Power | Limit |
| --- | --- |
| Add a new venue (pool or adapter) to the router | Must be proposed first and **wait 24 hours** in public before it can go live. The setup phase is locked, so there is no shortcut. |
| Remove a venue | Instant. Removing a venue can only take a route away, never add one. |
| Pause swaps | Instant, by the owner or the guardian. Only the owner can unpause. |
| Approve or remove makers on a pool | Makers also need a bond of at least **10 HYPE** to quote. |
| Slash a maker's bond | Sends the slashed HYPE to the treasury. Used when a maker posts abusive quotes. |
| Set the per-swap cap on a maker pool | Currently **$500** per swap on WHYPE/USDC. |
| Withdraw pool inventory | Maker pool inventory is supplied by Stoa today, not by outside depositors. |
| Set the referral share | Currently **10%** of the protocol fee. |
| Withdraw protocol fees | Only the protocol's share; referral earnings are claimable only by the referrer. |

The guardian can also tighten a pool: shorten how long quotes stay valid, set the pool fee within the hard maximum of 0.30%, add a quote check, and pull a live quote.

## What nobody can do

- **Upgrade the code.** No contract is upgradeable. The code verified on [Sourcify](https://repo.sourcify.dev/99901/0x104752D50ef893da579Ad813918269e09Ea17dbA) is the code that runs.
- **Move funds from your wallet.** The router only pulls the exact amount of the swap you sign, from you, inside that swap. The app approves only that amount unless you opt in to more.
- **Hold your funds between swaps.** The router finishes every swap in one transaction and checks what you received against your minimum.
- **Add a Uniswap V4 hook.** Only pools whose hooks are on the allowlist fixed at deployment can be added.
- **Take referral earnings.** They are claimable only by the referrer's own address.

## Settings at a glance

| Setting | Value |
| --- | --- |
| New-venue waiting period | 24 hours |
| Maker minimum bond | 10 HYPE |
| Maker bond withdrawal delay | 24 hours |
| Per-swap cap on maker pools | $500 |
| Protocol fee | 2 bps |
| Referral share | 10% of the protocol fee |

All values can be read on-chain from the contracts listed in [Contract addresses](contracts.md).
