# Internal security review

A review of the deployed contracts by the Stoa team, published in full. **This is not an external audit.** An independent audit is still planned before caps rise or vaults open.

## Update, 15 November 2026: Robinhood Chain contracts

A second round covering everything deployed since the first review, mostly on Robinhood Chain. The first review (12 November, Elysium) follows below, unchanged except for status updates.

| Item | Value |
| --- | --- |
| Contracts | StoaRouter (Robinhood Chain build, with Permit2), StoaPoolL2, BondRegistry, StoaBuyback, FeeDistributor, PonsCurveAdapter, the Aero and Ramses tick-spacing adapter, and the Uniswap V2, V3 and V4 adapters |
| Code | As deployed on Robinhood Chain; addresses on [Contracts](contracts.md) |
| Size | All Stoa contracts together: about 2,430 lines of Solidity 0.8.28 |

**Method.** Line-by-line reading of the new and changed paths (buyback, bonds, the L2 pool's block timing, the Pons curve adapter), Slither 0.11 with 102 detectors over every Stoa contract (85 results: every High and Medium result is triaged below or in the first review; the rest are gas and style notes), 73 unit and attack tests, and 22 fork tests against live Robinhood Chain venues and Pons curves. All pass.

**Result.** No issue allows anyone to take user funds. One new medium finding about admin trust, two new low findings, four informational. Every Slither result marked High is a false positive explained below or in the first review (I-2, I-3, I-4).

### M-3 The timelock can hand the fee contract to a new owner

**Status: by design, mitigated by the 48-hour timelock.** StoaBuyback forwards the owner's calls to the FeeDistributor, except the one that withdraws protocol fees. That keeps settings such as the referral share adjustable, and it also allows moving the FeeDistributor to a different owner, for example an improved buyback contract. A new owner could withdraw protocol fees, so the guarantee that fees can only buy and burn $STOA holds as long as no such move happens. Any move is a 2-of-3 Safe proposal that waits 48 hours in public on the timelock first.

### L-4 The buyback's price limit is set by the keeper

`StoaBuyback.buyback` takes the minimum output from the keeper. The keeper script quotes the router and allows 2% slippage, but the contract does not cap it. A leaked keeper key could therefore run buybacks with no price limit and lose part of the accrued fees to a sandwich. It could not send fees anywhere other than a $STOA burn. The keeper wallet holds only gas, and the owner can replace it through the timelock.

### L-5 Pons curve quotes copy Pons' own math

`PonsCurveAdapter` predicts a curve's output with the same formula as the Pons curve, fee and creator tax included (Slither flags its divide-then-multiply). If the prediction and the curve ever differ, the swap reverts on the adapter's own minimum, so a trade can fail but never fill worse than quoted. The adapter leaves the buy that would graduate a curve, and a launch's anti-sniper window, to Pons.

### I-5 Balance and reentrancy warnings on the Pons curve adapter (false positive)

Only the router, which is `nonReentrant`, can call the adapter's `swap`. The curve is looked up from the Pons factory and must match the token, and the adapter measures the ETH and tokens it actually receives. Unexpected extra ETH could only increase what the trader gets.

### I-6 Unused return values (by design)

The router, the buyback and the adapters ignore the amounts venues report and measure balances instead (see "What was checked and held up" below). Slither flags each ignored return value.

### I-7 Keeper can be set to the zero address (by design)

Setting StoaBuyback's keeper to zero leaves only the owner able to run buybacks. That is the intended way to stop the keeper.

### I-8 Strict equalities and zero-start variables (by design)

Slither flags strict equality checks in the router and the pools. They are the point: a venue must take exactly the input it was given, and a fee-on-transfer token is refused when the received amount differs. It also flags local variables in the V4 and Liquidity Book adapters that start at zero, which is the intended starting value.

## First review, 12 November 2026 (Elysium)

### Scope

| Item | Value |
| --- | --- |
| Date | 12 November 2026 |
| Contracts | StoaRouter, StoaPool, MakerRegistry, FeeDistributor, and the six venue adapters (Uniswap V2, V3, V4, Aero, Ramses, Liquidity Book) |
| Code | As deployed on Elysium mainnet and verified on [Sourcify](https://repo.sourcify.dev/99901/0x104752D50ef893da579Ad813918269e09Ea17dbA) |
| Size | About 1,760 lines of Solidity 0.8.28, OpenZeppelin 5.1 |

### Method

- Line-by-line reading of every swap, quote, bond, fee and admin path
- Static analysis with Slither (76 detectors); every result triaged below
- 57 unit and attack tests and 11 fork tests against live Elysium pools
- Two mainnet test swaps through the production router (HYPE to USDC and back), both successful

### Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 2 (1 resolved, 1 mitigated) |
| Low | 3 |
| Informational | 4 |

No issue allows anyone to take user funds. The two medium findings are about admin trust, not code bugs.

### Findings

#### M-1 Admin is a single wallet

**Status: resolved on 12 November 2026.** Ownership moved to a 2-of-3 Safe (see the update at the end of this finding). Original finding: The owner and guardian of every contract is one wallet. If its key leaks, an attacker could pause swaps, withdraw maker pool inventory, slash maker bonds or propose a new venue. They could **not** upgrade code, move funds from user wallets, or add a venue without the 24-hour public wait, which gives time to react. **Update:** every contract is now owned by the 2-of-3 admin Safe `0xBF715C84b1C0759C87Da368c1476b80ac0C5055F`. One leaked key can no longer act alone; the router guardian stays a single wallet that can only pause. See [Admin and permissions](admin.md).

#### M-2 Owner can withdraw maker pool inventory

**Status: mitigated on 12 November 2026.** Any withdrawal now waits 48 hours in public behind the timelock. Original finding: Maker pool inventory is supplied by Stoa itself, so this is how it is managed. Before any outside deposits are accepted, pool inventory moves into vaults the owner cannot withdraw from. Vaults stay closed until the external audit.

#### L-1 A quote outlives a maker's removal for up to 2 blocks

A pool checks the maker's approval and bond when a quote is posted, not on each swap. If a maker is removed or starts unbonding, its last quote stays valid until it expires, at most 2 blocks (about 200–400 ms). The owner or guardian can cancel a quote at once, and a bond stays slashable for 24 hours after unbonding starts.

#### L-2 Traders can name themselves as referrer

A trader can pass their own address as referrer and receive 10% of the protocol fee back, a rebate of 0.2 bps. This costs the protocol a little and nothing to other users. Accepted.

#### L-3 Direct pool swaps accept any recipient

`StoaPool.swap` does not itself reject the zero address as recipient; standard tokens such as WHYPE and USDC revert on such a transfer anyway. It only matters to someone calling the pool directly with a mistaken recipient, never through the router or app, which always checks the recipient.

#### I-1 Fee rounding

Pool and router fees are taken from an output that was already rounded down, so the fee can be off by less than one smallest unit of the token. Every rounding goes in the pool's favor; no loss to users.

#### I-2 Reentrancy warnings (false positive)

Slither flags external calls before balance checks in the router and adapters. Both router swap functions, the pool swap and every bond and fee withdrawal are `nonReentrant`, and venues must be allowlisted, so these paths cannot be re-entered.

#### I-3 Native HYPE sent to a caller-chosen address (by design)

The router sends native HYPE to the recipient the trader chose, after checking the output against the trader's minimum. The bond registry sends HYPE only to the maker withdrawing or to the treasury.

#### I-4 V4 key list "never initialized" (false positive)

The V4 adapter's pool list is a mapping filled by `register`. Slither's warning does not apply.

## What was checked and held up

- **Input and output are measured, not trusted.** Each leg checks that the venue took exactly the input, and the final output is measured against the trader's minimum.
- **Only allowlisted venues.** Unknown venues, wrong pairs and removed venues revert. Fork tests confirm adapters reject strangers and fake callbacks.
- **Approvals.** The router pulls only the swap amount from the caller and clears any approval it gives a pool.
- **Fee accounting.** Fees must be backed by tokens the distributor actually holds, and referral earnings can only be claimed by the referrer.
- **Bonds.** Slashing takes active bond first, then pending; a maker cannot withdraw within the 24-hour delay.
- **$STOA bonds.** BondRegistry rejects fee-on-transfer tokens, burns slashed $STOA, and keeps unbonding (3 days) longer than the timelock (48 hours), so a maker cannot leave before a slash lands. Fork-tested with the real $STOA token.
- **Buyback.** StoaBuyback has no function that sends protocol fees anywhere but a $STOA buy and burn, and its pass-through to the FeeDistributor refuses the fee withdrawal call (see M-3 for what the owner can still change). Fork-tested with real fees in USDG, WETH and a graduated Pons token.
- **No upgradeability.** No proxies, no self-destruct, no delegatecall to outside code.

## Next steps

1. ~~Move ownership to a multisig~~ Done: 2-of-3 admin Safe.
1. ~~Add a delay to admin actions~~ Done: 48-hour timelock in front of every contract; maker bonds take 3 days to withdraw.
2. External audit before raising the $500 per-swap cap or opening vaults.
3. Paid bug bounty alongside the audit. Until then, report issues by DM to [@StoaDEX](https://x.com/StoaDEX).
