# Stoa contracts (v1)

Maker-quoted pools (PropAMM) for Elysium, chain 99901.

| Contract | Job |
|---|---|
| `MakerRegistry` | Lists pools, approves makers, holds maker bonds in native HYPE (unbond delay, slashing to treasury). Its owner is also the guardian. |
| `StoaPool` | One per pair. An approved, bonded maker posts bid/ask, sizes and an expiry (max 2 blocks). Fills use up the quoted size. Per-swap cap in USDC (500 at launch). Charges the 2 bps protocol fee. |
| `StoaRouter` | Compares every Stoa pool for the pair with fallback venues (adapters for Uniswap, Nest, ...) and executes the best fill. Takes the same 2 bps on the fallback path. |
| `UniswapV2Adapter` | Fills swaps on Uniswap V2 (direct pair or two hops through WHYPE, since launchpad tokens trade against HYPE). Only the router can call it. |
| `FeeDistributor` | Receives protocol fees, credits 10% to the swap's referrer, the rest accrues to the protocol. Rejects fee notices not backed by tokens. |

## Launch mode: router first

Stoa can launch with no pool capital. With no maker quotes live, every swap is filled on Uniswap V2 through the adapter and Stoa takes its 2 bps. Maker pools join the same router later and win whenever they quote a better price.

The router also takes native HYPE in (`swapExactHYPEIn`) and pays it out (`swapExactInForHYPE`).

## Run

```
forge build
forge test
```

34 tests, including a fuzz test that checks a pool never pays out more than its maker's quote and that `quoteOut` matches `swap`.

## Deploy (Elysium mainnet)

```
OWNER=0x... TREASURY=0x... CURATOR=0x... MAKER=0x... MIN_BOND=10000000000000000000 UNIV2_ROUTER=0x... \
forge script script/Deploy.s.sol --rpc-url $ELYSIUM_RPC --broadcast --account deployer
```

Ownership moves to `OWNER` in two steps: run `acceptOwnership()` from the multisig on each contract.

## Not in v1 yet

- Public LP vaults (ERC-4626). v1 inventory comes from the pool owner.
- Uniswap V4 and Nest adapters (V2 is done; add the V2 router address at deploy with `UNIV2_ROUTER`).
- `liquidationSwap` and Permit2.
- GraduationRegistry.
- An external audit. Do not raise caps before one.

## Known trade-offs

- One live quote per pool. Several approved makers overwrite each other; v1 runs one maker per pool.
- A maker could update its quote ahead of a pending swap in the same block. Traders are protected by `minOut`; quotes are capped in size and time.
- Fee-on-transfer and rebasing tokens are not supported.
