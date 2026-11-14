# $STOA

$STOA is Stoa's official token, launched on [Pons](https://ponsfamily.com/launchpad/0x13E6993417616De724F2b337D65063f229e96718) on Robinhood Chain: `0x13E6993417616De724F2b337D65063f229e96718`. It has two jobs, both enforced by contracts. Live numbers are on the [$STOA page](https://stoadex.com/token).

## 1. Protocol fees buy and burn $STOA

Every swap through Stoa on Robinhood Chain pays a 2 bps protocol fee to the FeeDistributor (referrers keep their 10% share). The FeeDistributor is owned by **StoaBuyback**, a contract with one way to move protocol fees out: swap them into $STOA through the Stoa router and send the $STOA to the burn address `0x…dEaD`, in the same transaction.

- **Every Monday** a keeper wallet runs the buyback for each fee token worth at least $1 that has a route to $STOA. Smaller amounts wait for the next week. Fees that are already $STOA are burned without a swap.
- The keeper only chooses the route and a minimum output (2% slippage). It cannot send fees anywhere else: the contract does not allow it.
- The buyback swap pays the normal 2 bps fee, in $STOA, which the next run burns too.
- While $STOA is still on its Pons bonding curve the router has no route to it, so fees wait and are used after it graduates to Uniswap V4.
- The owner (the 48-hour timelock) keeps the FeeDistributor's other settings, such as the referral share, through StoaBuyback. It cannot withdraw protocol fees. Changing the policy itself would mean handing the FeeDistributor to a different contract, a public 48-hour timelock action like every other.

Every buyback emits `BoughtAndBurned(token, amountIn, stoaBurned)`, and `totalBurned()` on StoaBuyback adds them up.

The handover of the FeeDistributor to StoaBuyback was scheduled in the timelock on 15 November 2026 ([transaction](https://robinhoodchain.blockscout.com/tx/0xcde838eaf0c90199f58053964acf903f6d69853fce3b07681125546d0ccc7c07)) and runs from 17 November 2026. Fees collected before then are included in the first run.

Today this covers Robinhood Chain, where $STOA lives. Fees on Elysium stay in Elysium's FeeDistributor.

## 2. Makers bond $STOA

Stoa maker pools on Robinhood Chain are quoted by makers who bond $STOA in the **BondRegistry**.

- One bond per maker covers all its pools. A maker can quote a pool while the owner has approved it for that pool and its bond is at least the pool's minimum.
- A maker that posts abusive quotes can be **slashed**. Slashed $STOA is **burned**, not sent to anyone.
- Withdrawing a bond takes **3 days**, longer than the 48-hour timelock, so a slash always lands before a maker can leave.
- Bonding opens with the first Robinhood Chain maker pool. A bond earns nothing by itself: it only lets an approved maker quote. To run a pool, see [Become a curator](become-a-curator.md).

## Supply

$STOA has a fixed supply of 1,000,000,000, all minted at launch on Pons. Nothing can mint more.

- **Total supply** is everything minted minus what sits at the burn address `0x…dEaD`.
- **Circulating supply** is the total supply minus the unsold $STOA still on the Pons bonding curve. When the curve graduates, that $STOA moves into the Uniswap V4 pool and counts as circulating.

The numbers are read from Robinhood Chain every 5 minutes and served for trackers and anyone else:

| Endpoint | Returns |
| --- | --- |
| [`/api/stoa/supply`](https://stoadex.com/api/stoa/supply) | JSON: max, total, circulating, burned, on the curve, curve progress |
| [`/api/stoa/total-supply`](https://stoadex.com/api/stoa/total-supply) | Total supply as a plain number |
| [`/api/stoa/circulating-supply`](https://stoadex.com/api/stoa/circulating-supply) | Circulating supply as a plain number |

## What $STOA is not

- **Not a share of fees.** Protocol fees burn $STOA. Holders are not paid anything.
- **Not a yield product.** Bonding earns nothing by itself and can be slashed.
- **Not audited yet.** StoaBuyback and BondRegistry are source-verified on Sourcify, like every Stoa contract, and covered by unit and fork tests. They have not had an external audit.

## Contracts (Robinhood Chain)

| Contract | Address |
| --- | --- |
| $STOA | [`0x13E6993417616De724F2b337D65063f229e96718`](https://robinhoodchain.blockscout.com/address/0x13E6993417616De724F2b337D65063f229e96718) |
| StoaBuyback | [`0x2Eb53EBA6f04447d9ce03B4AfB421887239ae244`](https://robinhoodchain.blockscout.com/address/0x2Eb53EBA6f04447d9ce03B4AfB421887239ae244) |
| BondRegistry | [`0x7eD43F104f9317578806De89e9d478D297d468D4`](https://robinhoodchain.blockscout.com/address/0x7eD43F104f9317578806De89e9d478D297d468D4) |
| FeeDistributor | [`0x76c30317bB8C0bC47E2aC5D83b329FE9F386F4e7`](https://robinhoodchain.blockscout.com/address/0x76c30317bB8C0bC47E2aC5D83b329FE9F386F4e7) |

Both new contracts are owned by the 48-hour timelock and verified on [Sourcify](https://repo.sourcify.dev/4663/0x2Eb53EBA6f04447d9ce03B4AfB421887239ae244) (exact match).
