# Stoa contracts (v1)

Maker-quoted pools (PropAMM) for Elysium, chain 99901.

| Contract | Job |
|---|---|
| `MakerRegistry` | Lists pools, approves makers, holds maker bonds in native HYPE (unbond delay, slashing to treasury). Its owner is also the guardian. |
| `StoaPool` | One per pair. An approved, bonded maker posts bid/ask, sizes and an expiry (max 2 blocks). Fills use up the quoted size. Per-swap cap in USDC (500 at launch). Charges the 2 bps protocol fee. Optional `IQuoteGuard` (set by the guardian) rejects quotes far from an independent price. |
| `StoaRouter` | `quote` (eth_call) finds the best route: every Stoa pool and fallback venue (Uniswap adapters), direct or in two legs through WHYPE with the best venue per leg. `swap` executes a given route through allowlisted venues only, measures what the user actually receives (never trusts a venue), and charges the 2 bps fee once per swap (by the pool if the route uses one, otherwise by the router). Native HYPE in and out, Permit2 signature transfers, owner `sweep` for stray tokens. Pausable by the owner or a guardian; new venues are timelocked after setup. |
| `UniswapV2Adapter` | Fills swaps directly on Uniswap V2 pairs (direct or two hops through WHYPE). Only the router can call it. |
| `UniswapV3Adapter` | Fills swaps directly on Uniswap V3 pools, every fee tier, direct or through WHYPE. Quotes by simulating the pool swap. Only the router can call it. |
| `UniswapV4Adapter` | Fills swaps on Uniswap V4 pools, including native-HYPE pools and launchpad pools with hooks (most long-tail tokens on Elysium trade there). V4 pools cannot be listed on-chain, so it keeps up to 6 pool keys per pair: anyone can register an initialized pool whose hooks contract is on the allowlist fixed at deployment; the owner can only remove keys. |
| `CLTickSpacingAdapter` | Fills swaps on V3-style pools keyed by tick spacing. Deployed twice: Aero Slipstream and Ramses CL. |
| `LiquidityBookAdapter` | Fills swaps on Liquidity Book (DLMM) pairs, every bin step the factory lists. |
| `FeeDistributor` | Receives protocol fees, credits 10% to the swap's referrer, the rest accrues to the protocol. Rejects fee notices not backed by tokens. |

## Launch mode: router first

Stoa can launch with no pool capital. With no maker quotes live, every swap is filled on the deepest outside venue (Uniswap V2/V3/V4, Aero, Ramses or Liquidity Book; addresses in `script/VenuesElysium.sol`) and Stoa takes its 2 bps. Maker pools join the same router later and win whenever they quote a better price.

Native HYPE is passed as `address(0)` on either side of `swap`; the router wraps and unwraps it.

Security model, trusted roles and the Slither triage: [SECURITY.md](SECURITY.md).

## Run

```
forge build
forge test
```

57 unit and attack tests plus 11 fork tests against Elysium mainnet (`ELYSIUM_RPC_URL=https://rpc.elysium.kinetiq.xyz forge test --match-contract Fork`; CI runs them on every push), including a fuzz test that checks a pool never pays out more than its maker's quote and that `quoteOut` matches `swap`, and a Permit2 swap signed against the real Permit2 deployment.

## Deploy (Elysium mainnet)

Preferred: GitHub → Actions → **Deploy contracts** (dry run first, then tick *broadcast*). Needs repo secrets `DEPLOYER_PRIVATE_KEY`, `ELYSIUM_RPC_URL` and variables `OWNER`, `TREASURY` (optional `CURATOR`, `MAKER`, `GUARDIAN`, `MIN_BOND`, `MAX_SWAP_USDC`, `ROUTER_DELAY`). After a broadcast the workflow commits `deployments/99901.json` and `web/lib/deployments.json`, and Vercel redeploys the site with the addresses.

Manual:

```
OWNER=0x... TREASURY=0x... \
forge script script/Deploy.s.sol --rpc-url $ELYSIUM_RPC --broadcast --account deployer
```

Ownership moves to `OWNER` in two steps: run `acceptOwnership()` from the multisig on each contract.

## Not in v1 yet

- Public LP vaults (ERC-4626). v1 inventory comes from the pool owner.
- Fee-on-transfer (taxed) tokens through the Uniswap adapters.
- `liquidationSwap`.
- An external audit. Do not raise caps before one.

## Known trade-offs

- One live quote per pool. Several approved makers overwrite each other; v1 runs one maker per pool.
- A maker could update its quote ahead of a pending swap in the same block. Traders are protected by `minOut`; quotes are capped in size and time.
- Fee-on-transfer and rebasing tokens are not supported.
