# Known issues

Findings already published in the internal review ([stoadex.com/docs/security-review](https://stoadex.com/docs/security-review), which has the full write-up of each). Please treat them as known: a report is still welcome if it shows a new impact or a worse path than the one described there.

## Medium and Low

| ID | Contract | Finding | Status |
| --- | --- | --- | --- |
| M-1 | All | Admin was a single wallet | Resolved: 2-of-3 Safe behind a 48 h timelock |
| M-2 | StoaPool | The owner can withdraw maker pool inventory | Mitigated by the 48 h timelock; inventory is Stoa's own, and vaults stay closed until audited |
| M-3 | StoaBuyback | The timelock can hand the FeeDistributor to a new owner through `exec` | By design, behind the 48 h timelock |
| L-1 | StoaPool | A quote outlives a maker's removal for up to 2 blocks | Accepted; the owner or guardian can cancel a quote at once |
| L-2 | StoaRouter | Traders can name themselves as referrer (a 0.2 bps rebate) | Accepted |
| L-3 | StoaPool | A direct pool swap accepts any recipient | Accepted; the router and the app check it |
| L-4 | StoaBuyback | The keeper sets the buyback's price limit | Accepted; the keeper script allows 2% |
| L-5 | PonsCurveAdapter | Curve quotes copy Pons' own math | Accepted; a mismatch reverts, it never fills worse than quoted |
| L-6 | SpotlightMarket | The keeper sets the burn's price limit | Accepted |
| L-7 | SpotlightMarket | The guardian can pause new activity indefinitely (only the timelock unpauses) | Accepted; claims, refunds, withdrawals and `emergencyWithdraw` keep working |
| L-8 | RugCover | The keeper sets the burn's price limit | Accepted |
| L-9 | RugCover | The guardian can pause new covers indefinitely | Accepted; claims, breaches, releases and unlocks keep working |
| L-10 | StoaLimit | The keeper decides when, and along which route, an order fills | Accepted; never below `minOut`, and the maker can fill or cancel |
| L-11 | StoaRouter, StoaPool | A route through two Stoa pools pays the pool fee on each leg | Docs corrected; not reachable live (one Stoa pool) |

## Informational

| ID | Contract | Finding |
| --- | --- | --- |
| I-1 | StoaRouter, StoaPool | Fee rounding (always in the pool's favor, under one unit) |
| I-2 | StoaRouter, adapters | Reentrancy warnings (false positive) |
| I-3 | StoaRouter, MakerRegistry | Native gas token sent to a caller-chosen address (by design) |
| I-4 | UniswapV4Adapter | V4 key list "never initialized" (false positive) |
| I-5 | PonsCurveAdapter | Balance and reentrancy warnings (false positive) |
| I-6 | StoaRouter, StoaBuyback, adapters | Unused return values: balances are measured instead (by design) |
| I-7 | StoaBuyback | The keeper can be set to the zero address (by design) |
| I-8 | StoaRouter, pools | Strict equalities and zero-start variables (by design) |
| I-9 | SpotlightMarket | A project can vote for its own token (by design) |
| I-10 | SpotlightMarket | Rounding and unclaimed ETH (by design) |
| I-11 | SpotlightMarket | Slither results (false positives or by design) |
| I-12 | RugCover | Only the creator's own wallet is watched (by design) |
| I-13 | RugCover | A creator can buy their own cover from other wallets (by design: they always lose at least the burned share of a quarter of the bond) |
| I-14 | RugCover | Cover follows the purchase, not the buyer's later balance (by design) |
| I-15 | RugCover | Slither results (false positives or by design) |
| I-16 | StoaLimit | Fills are limited to the keeper and the maker (by design) |
| I-17 | StoaLimit | Tokens that change balances on their own are not supported |
| I-18 | SpotlightMarket | The 255-entry cap counts canceled tokens (by design) |

## Also by design

- Parameter changes (Spotlight, Rug Cover) apply to later weeks or newly opened terms only, never to ones in progress.
- Fee-on-transfer tokens are refused where an exact amount must arrive (router legs, StoaLimit deposits, BondRegistry bonds, Spotlight locks). Rug Cover locks only ever take $STOA, which has no transfer fee.
- The Safe's three signers are all held by the Stoa team today: the Safe protects against one lost or leaked key, not against the team.
