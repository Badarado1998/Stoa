# Stoa contracts: audit guide

Stoa ([stoadex.com](https://stoadex.com)) is a best-price swap router with maker-quoted pools, live on Robinhood Chain (4663) and Elysium (99901). Every swap is quoted against every allowlisted venue and filled where the trader gets the most, for a 2 bps protocol fee. Three products sit on top of the router and hold user funds: Spotlight (weekly ETH bids paid to $STOA voters), Rug Cover (creator ETH bonds that pay covered buyers if the creator dumps) and limit orders.

No contract is upgradeable. Every contract is owned by a 48-hour OpenZeppelin `TimelockController` that only a 2-of-3 Safe can use. Known issues are in [KNOWN_ISSUES.md](KNOWN_ISSUES.md); the full internal review is at [stoadex.com/docs/security-review](https://stoadex.com/docs/security-review).

## Scope

Everything in `src/` except `interfaces/` and `tools/`, about 3,100 nSLOC (non-blank, non-comment lines). Priority 1 holds or routes user ETH.

| Contract | nSLOC | Priority | Chain | Holds |
| --- | --- | --- | --- | --- |
| `RugCover` | 514 | 1 | Robinhood Chain | Creator bonds (ETH), locked $STOA, unclaimed covers, backer income |
| `SpotlightMarket` | 473 | 1 | Robinhood Chain | Project bids (ETH), locked $STOA, voter payouts, burn pot |
| `StoaRouter` | 411 | 1 | Both | Nothing between swaps; pulls the exact input (approval or Permit2) |
| `StoaLimit` | 204 | 1 | Robinhood Chain | Limit order deposits (ETH and ERC-20) |
| `StoaPool` | 194 | 2 | Elysium | Maker inventory |
| `StoaPoolL2` | 200 | 2 | Robinhood Chain (not deployed yet) | Maker inventory |
| `BondRegistry` | 120 | 2 | Robinhood Chain | Maker bonds in $STOA |
| `MakerRegistry` | 115 | 2 | Both | Nothing |
| `StoaBuyback` | 82 | 2 | Robinhood Chain | Protocol fees, only until they are swapped into $STOA and burned |
| `FeeDistributor` | 70 | 2 | Both | Protocol fees and referral shares |
| `adapters/UniswapV4Adapter` | 207 | 3 | Both | In flight only |
| `adapters/UniswapV3Adapter` | 138 | 3 | Both | In flight only |
| `adapters/CLTickSpacingAdapter` (Aero, Ramses) | 119 | 3 | Both | In flight only |
| `adapters/PonsCurveAdapter` | 106 | 3 | Robinhood Chain | In flight only |
| `adapters/LiquidityBookAdapter` | 80 | 3 | Elysium | In flight only |
| `adapters/UniswapV2Adapter` | 78 | 3 | Both | In flight only |

Deployed addresses: `web/lib/deployments-4663.json` (Robinhood Chain) and `web/lib/deployments.json` (Elysium); all verified on Sourcify.

**Out of scope:** OpenZeppelin Contracts 5.1.0, the Safe, Permit2, the outside venues the adapters call (Uniswap, Aero, Ramses, Liquidity Book, Pons), the $STOA token itself (a Pons launch), `tools/SafetySim.sol` (only ever run through `eth_call`, never deployed), `script/` and the web app.

## Build and test

Use **Foundry 1.5.1** (`foundryup -i 1.5.1`). `RugCover`, `SpotlightMarket` and `StoaLimit` are deployed through the deterministic CREATE2 deployer with addresses the app ships, and newer Foundry versions produce different bytecode for the same source. For the same reason `forge fmt` skips those files (see `foundry.toml`).

```sh
forge build
forge test --no-match-contract Fork          # 150 unit, attack and fuzz tests + 11 invariant tests (about 30 s)
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
ELYSIUM_RPC_URL=https://rpc.elysium.kinetiq.xyz \
forge test --match-contract Fork             # 36 fork tests against live state (about 6 min; 3 Elysium swap tests
                                             # skip while Elysium has no Uniswap V2/V3 WHYPE/USDC liquidity)
forge coverage --no-match-coverage "(test|script|mocks)" --report summary
```

Fork tests are skipped when their RPC URL is not set. `ForkRobinhoodPons` picks the newest ETH-quoted Pons launch still on its bonding curve; set `PONS_TOKEN=0x...` to pin one. Settings: solc 0.8.28, optimizer 20,000 runs, EVM `cancun`, no via-IR; fuzz 512 runs; invariants 64 runs of 128 calls.

## How it works

**Swaps.** `StoaRouter.quote` (called with `eth_call`, since adapters simulate) returns the best route: one leg, or two legs through the wrapped gas token (WETH on Robinhood Chain, WHYPE on Elysium). Each leg is a Stoa maker pool or an adapter to an outside venue. `swap` and `swapWithPermit2` pull the exact input, run the legs, check that each venue spent exactly its input (`InputNotSpent`) and that the recipient received at least `minOut`, measured by balance. The native token is `address(0)`.

**Fees.** The router charges 2 bps on the final leg, unless the route uses a Stoa pool, which charges its own 2 bps on its leg instead (a route through two Stoa pools pays twice, L-11). Fees go to `FeeDistributor` with `notifyFee`, which credits 10% to the swap's referrer. On Robinhood Chain the FeeDistributor is being handed to `StoaBuyback` through the timelock: after that, protocol fees can only be swapped into $STOA and sent to `0x...dEaD`.

**Venues.** Pools and adapters are an allowlist. After `lockSetup()`, adding one takes `propose`, the router's own 24-hour `delay`, then `execute`, all through the 48-hour timelock (72 hours in public). Removing is instant through the timelock.

**Maker pools.** A maker posts a quote to its pool; `MakerRegistry` decides who may quote (with a HYPE bond on Elysium), and on Robinhood Chain `BondRegistry` holds makers' $STOA bonds and burns slashed ones. A quote is checked when posted and expires quickly (at most 2 blocks on Elysium).

**Spotlight.** Weekly epochs. Projects bid ETH for a token during the first 5 days (the first bid also pays an entry fee that grows with the number of entrants). $STOA holders lock and vote for up to 10 tokens. After the week anyone calls `finalize`: among tokens at the quorum, the largest bids win the slots; a cut of each winning bid goes to the burn pot, the rest to that token's voters pro rata. Losing and canceled bids are refundable. The keeper burns the pot through the router.

**Rug Cover.** A Pons token's creator opens a term with an ETH bond; the floor is their whole token balance. Buyers call `buyCovered` (a router swap from ETH to the token, plus a premium) and hold cover equal to the ETH swapped, at most 75% of the bond per term. If the creator's balance drops below the floor before release, anyone calls `breach` for a bounty, every buyer claims their cover, and the rest of the bond goes to the burn pot and to $STOA backers (streamed over 7 days). Otherwise the creator releases the bond after the term plus a 24-hour grace.

**Limit orders.** `StoaLimit.create` escrows the input; the keeper (or the maker) fills it through the router, which pays the maker directly and reverts below `minOut`. The maker can cancel at any time, paused or not; after expiry anyone can cancel, and the deposit still goes only to the maker.

## Roles

| Role | Holder | Can | Cannot |
| --- | --- | --- | --- |
| Owner | 48 h timelock, used only by a 2-of-3 Safe (all signers held by the team) | Set parameters within fixed bounds, keeper and guardian; unpause; add (72 h) or remove venues; approve and slash makers; withdraw maker pool inventory; forward calls through `StoaBuyback` | Upgrade anything; take user deposits, bids, bonds, covers or locked $STOA; withdraw fees once `StoaBuyback` owns the FeeDistributor |
| Guardian | Single wallet | Pause the router, Spotlight, Rug Cover and StoaLimit; cancel a Spotlight bid while bids are open | Unpause; move funds |
| Keeper | Hot wallet, cron every 5 minutes | Run the $STOA burns (setting their price limit) and fill limit orders | Fill below `minOut`; send funds anywhere else |
| Anyone | | `breach` a Rug Cover term; `finalize` a Spotlight week; cancel an expired limit order | |

User exits keep working while paused: Spotlight and Rug Cover claims, refunds, unlocks and `emergencyWithdraw`; limit order cancels.

## Invariants we test

The suites in `test/invariant/` drive each fund-holding contract with random sequences of every user, keeper, guardian and owner action, plus time, and check after every call:

- **StoaLimit:** it holds exactly the deposits of open orders, in ETH and tokens, to the wei; the open list and per-maker counts match the orders; every fill paid at least `minOut` and every cancel returned the whole deposit; a closed order never reopens.
- **RugCover:** its ETH covers open bonds, unclaimed covers, the burn pot, breach bounties, earned and still-streaming backer income; its $STOA equals what backers locked; `totalBonds`, `totalOwed`, `totalActive` and `totalLocked` match the terms and backers they sum; no term sells more cover than its capacity (at most 75% of the bond) and no wallet more than its cap; a claim pays exactly the buyer's cover.
- **SpotlightMarket:** its ETH equals the burn pot plus every pending or refundable bid plus every unclaimed winning payout, to the wei; its $STOA equals what holders locked; vote tallies equal the votes behind them; nobody votes more than their active $STOA in the week in progress; each week has at most `slots` winners, all at the quorum and not canceled, and no eligible loser bid more than a winner.

## Where we want the most scrutiny

1. Rug Cover economics: can a creator, a backer or a buyer extract value across a term (self-cover, timing around `SALE_STOP` and `GRACE`, transfers instead of sales, partial claims)? Payouts are fixed in ETH at purchase; there is no price feed.
2. ETH accounting and rounding in Spotlight payouts and Rug Cover backer streaming: can any wei be taken twice or stuck?
3. The keeper's price limit on burns (L-4, L-6, L-8) and its control over fill timing (L-10): how much can a leaked keeper key or a sandwich take?
4. `PonsCurveAdapter` predicts the curve's output with Pons' own math (L-5): can a mismatch be exploited, or only make a swap revert?
5. Router accounting: exact-input checks, native wrapping and unwrapping, `sweep`, Permit2, reentrancy through venues or tokens.
6. The pause model: does every user exit really work while paused, and can a pause trap anyone?

## Changes during the audit

`RugCover`, `SpotlightMarket` and `StoaLimit` are frozen CREATE2 deployments: a fix means a new contract at a new address and a migration, not a patch, so we will batch fixes and ask for one fix review. Report anything you find through the channels in [SECURITY.md](../SECURITY.md).
