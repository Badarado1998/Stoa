# Stoa contracts

Solidity 0.8.28, Foundry. Deployed on Elysium (chain 99901) and Robinhood Chain (chain 4663). No proxies: every contract is immutable and source-verified on Sourcify.

## Contracts

| Contract | Job | Elysium | Robinhood |
| --- | --- | :-: | :-: |
| `StoaRouter` | `quote` (eth_call) finds the best route over every Stoa pool and venue adapter, direct or in two legs through the wrapped native token. `swap` executes it through allowlisted venues only, measures what the trader receives against `minOut`, and charges the 2 bps fee once per swap. Native coin in and out, Permit2 transfers, pausable by owner or guardian; new venues wait `delay` after setup. | ✓ | ✓ |
| `StoaPool` | Maker-quoted pool for one pair. An approved, bonded maker posts bid/ask, sizes and an expiry (max 2 blocks); fills use up the quoted size. Per-swap cap, optional `IQuoteGuard`. | ✓ | |
| `StoaPoolL2` | `StoaPool` for Arbitrum Orbit chains: quote expiry counts the chain's own blocks (ArbSys), not the parent chain's `block.number`. | | ready |
| `MakerRegistry` | Lists pools, approves makers, holds maker bonds in the native coin; slashed bonds go to the treasury. | ✓ | ✓ |
| `BondRegistry` | Same pool-facing interface, bonds in $STOA (one bond per maker across pools, 3-day unbonding); slashed bonds are burned. | | ✓ |
| `FeeDistributor` | Receives protocol fees, credits 10% to the swap's referrer, the rest accrues to the protocol. Rejects fee notices not backed by tokens. | ✓ | ✓ |
| `StoaBuyback` | Owns the FeeDistributor: protocol fees leave it only as a router swap into $STOA that is burned in the same call. The owner keeps the other settings through `exec`, which refuses `withdrawProtocol`. | | ✓ |
| `UniswapV2Adapter`, `UniswapV3Adapter` | Fill on Uniswap V2 pairs and V3 pools (every standard fee tier). Only the router can call them. | ✓ | ✓ |
| `UniswapV4Adapter` | Fills on V4 pools, including native-coin pools and launchpad pools with hooks. Anyone can register an initialized pool whose hooks are on the allowlist fixed at deployment (max 6 keys per pair). | ✓ | ✓ |
| `CLTickSpacingAdapter` | Fills on V3-style pools keyed by tick spacing: Aero Slipstream and Ramses. | ✓ | being added |
| `LiquidityBookAdapter` | Fills on Liquidity Book (DLMM) pairs. | ✓ | |

Addresses: [stoadex.com/docs/contracts](https://stoadex.com/docs/contracts). Security model, trusted roles and known limits: [SECURITY.md](SECURITY.md).

## Governance

Every contract is owned by an OpenZeppelin `TimelockController` with a 48-hour delay. Its only proposer, executor and canceller is a 2-of-3 Safe. The router's guardian can pause swaps and nothing else. Adding a venue after setup takes the timelock plus the router's own delay (24 hours), so 72 hours in public.

`script/SafeRunner.sol` runs Safe transactions the way the admin page does (`approveHash`, then `execTransaction` with pre-approved signatures); `RolloutVenuesRobinhood` and `RolloutBuybackRobinhood` use it to move timelocked actions forward when they are due.

## Tests

```bash
forge build
forge test                                   # 73 unit, attack and fuzz tests
ELYSIUM_RPC_URL=https://rpc.elysium.kinetiq.xyz forge test --match-contract "ForkElysium|ForkVenues"
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract ForkRobinhood
```

The 20 fork tests trade against live pools on both chains: every venue and every allowed V4 hook with a real buy and sell, a Permit2 swap signed against the real Permit2, the real Safe and timelock adding venues and handing the FeeDistributor to `StoaBuyback`, live protocol fees bought and burned, and real $STOA bonded, unbonded and slashed. Local forks of Robinhood Chain mock the ArbSys precompile.

## Deploy

All deployments run from GitHub Actions with a dry run first, then a broadcast, and commit the addresses to `web/lib/deployments*.json`:

| Workflow | Deploys |
| --- | --- |
| `deploy-contracts.yml` | Elysium (router, pool, registry, distributor, adapters) |
| `deploy-robinhood.yml` | Robinhood Chain: Safe, timelock, router, registry, distributor, Uniswap adapters |
| `deploy-robinhood-venues.yml` | Aero and Ramses adapters for the Robinhood router |
| `deploy-robinhood-token.yml` | `StoaBuyback` and `BondRegistry` |

## Not in v1

- Public LP vaults (ERC-4626): they open after an external audit.
- Fee-on-transfer and rebasing tokens (swaps revert; funds are not lost).
- An external audit. Per-swap caps stay low until there is one.
