# Stoa contracts: security notes

Status: **not audited**. Per-swap caps stay at $500 on maker pools until an external audit is done.

## Design guarantees

| Guarantee | How |
|---|---|
| The router never trusts a venue | It measures what the recipient actually received and reverts below `minOut`; it reverts if a venue did not take exactly `amountIn` (`InputNotSpent`). Tested with lying and skimming pools. |
| Routes use allowlisted venues only | `swap` takes a route from the caller but rejects any venue that is not a registered adapter, or a registered pool for exactly that pair (`UnknownVenue`); the hop token cannot be either end. |
| One fee per swap | A two-leg route pays the protocol fee once: inside the Stoa pool if one is used, otherwise on the router's final leg. |
| No surprise venues | After `lockSetup()`, new pools/adapters must be `propose`d and wait `delay` (default 1 day, allowed 1 h–14 d) before `execute`. Removals are instant. |
| Emergency stop | Owner or guardian can `pause()` the router; only the owner can `unpause()`. Pools have their own pause. |
| Users only risk the swap they sign | The router pulls exactly `amountIn` from `msg.sender` (by approval or a Permit2 signature from `msg.sender` itself) inside a swap and makes no arbitrary calls; every path has a deadline and `minOut`. The web app approves only the swap amount by default. |
| Stale or reused maker quotes cannot fill | Quotes expire after at most 2 blocks; every fill consumes quoted size. |
| No unbacked fee credit | `FeeDistributor` checks its balance covers everything it has accounted for. |
| Fake callbacks rejected | V3-style callbacks only pay a pool the factory returns for that pool's own tokens and fee or tick spacing; the V4 callback only accepts the PoolManager. |
| V4 pool registry | Anyone can register a V4 pool key, but only for initialized pools whose hooks are on an allowlist fixed at deployment; at most 6 keys per pair, and a full pair only accepts a pool with more in-range liquidity than its weakest. The adapter owner can only remove keys. A bad pool can at worst make a route revert: the router still measures output against `minOut`. |
| Fee-on-transfer input rejected | Router and pools check that the amount received equals `amountIn`. |
| Immutable code | No proxies; a fix means a new deployment. |

## Trusted roles

| Role | Can | Mitigation |
|---|---|---|
| Owner (router, registry, distributor) | propose/add venues (timelocked after setup), remove venues, pause, `sweep` tokens sent to the router by mistake (it holds no user funds between swaps), set fees up to 30 bps, slash bonds, withdraw the protocol's fee share | Multisig or hardware wallet; two-step ownership transfer; timelock on additions |
| Guardian | pause the router; set pool fees (≤30 bps), quote expiry and the pool quote guard | Cannot move funds; a bad guard can only block quotes, and swaps then fall back to Uniswap |
| Pool owner (curator) | withdraw its own pool inventory, set its per-swap cap | Its own capital |
| Maker | post quotes | Bonded and slashable; short-lived, size-limited quotes; traders protected by `minOut` |

## Known limits

- Aero's Slipstream swap hook reads Arbitrum's ArbSys precompile. Local forks need it mocked (the fork tests do this); on Elysium it is native.
- Adapters pick their pool again at execution time, so a two-leg route costs up to about 1.1M gas.

- A maker can update its quote ahead of a pending swap in the same block, within the trader's slippage. Keep slippage low; slash abusive makers.
- Fee-on-transfer and rebasing tokens are not supported (swaps revert, funds are not lost).
- The Uniswap V2 adapter assumes the standard 0.3% pair fee; a fork with a different fee makes swaps revert, not lose funds.

## Static analysis (Slither)

Run: `slither . --filter-paths "lib/|test/|script/" --exclude-informational --exclude-optimization`

| Finding | Verdict |
|---|---|
| arbitrary-send-eth (bond withdrawal, HYPE payout) | Intended: sends only to the bond owner, the treasury or the swap's recipient |
| reentrancy-balance in `_leg` and `swapWithPermit2` | Intended: every swap entry point is `nonReentrant`; balances are re-measured on purpose |
| unused-return on venue `swap` | Intended: output is measured, not trusted |
| divide-before-multiply in `StoaPool.swap` | Rounding moves at most 1 wei of fee |
| incorrect-equality (`gross == 0`, `amountOut == 0`) | Intended zero guards |
| calls-loop in `quote` and the V3 adapter | Bounded by `MAX_VENUES = 16` and four fee tiers; venues are owner-curated and timelocked; `quote` is meant for eth_call |
| timestamp (unbonding, deadlines) | Second-level precision is fine |
| missing-zero-check | Fixed in constructors and `setGuardian`. Two remaining hits are false positives: OpenZeppelin `Ownable` already rejects a zero owner, and `to` is checked in `_check` |

## Reporting

DM @StoaDEX on X. Please do not disclose publicly before a fix.
