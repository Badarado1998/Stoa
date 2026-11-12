# Contract addresses

Network tokens on Elysium and Stoa contracts, live on Elysium mainnet since block 5,216,650.

| Contract | Address |
| --- | --- |
| WHYPE | `0xbA876237B0F021A6c6D852d6c26E107997cC5E81` |
| USDC | `0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| StoaRouter | [`0x104752D50ef893da579Ad813918269e09Ea17dbA`](https://elysium.kinetiq.xyz/address/0x104752D50ef893da579Ad813918269e09Ea17dbA) |
| StoaPool (WHYPE/USDC) | [`0x7800220F420C63F5Ed5e60a75E864465ff49400a`](https://elysium.kinetiq.xyz/address/0x7800220F420C63F5Ed5e60a75E864465ff49400a) |
| MakerRegistry | [`0x9aC98F9dd7c796cF7d3544C945f9eB75AC56aDa0`](https://elysium.kinetiq.xyz/address/0x9aC98F9dd7c796cF7d3544C945f9eB75AC56aDa0) |
| FeeDistributor | [`0x19C1C6b5924C3257a03D29b2DB0Acd9d4492aD1e`](https://elysium.kinetiq.xyz/address/0x19C1C6b5924C3257a03D29b2DB0Acd9d4492aD1e) |
| UniswapV2Adapter | [`0x9c4b918a56Bb5328EEA59fDfc5805e87855363eF`](https://elysium.kinetiq.xyz/address/0x9c4b918a56Bb5328EEA59fDfc5805e87855363eF) |
| UniswapV3Adapter | [`0x3706B9467161B1c37915Df8f9B877Db60a9290F5`](https://elysium.kinetiq.xyz/address/0x3706B9467161B1c37915Df8f9B877Db60a9290F5) |
| UniswapV4Adapter | [`0xEB4BEC2795Ce314d1add4f8b3f2FCfBF38e892e5`](https://elysium.kinetiq.xyz/address/0xEB4BEC2795Ce314d1add4f8b3f2FCfBF38e892e5) |
| AeroAdapter | [`0x9C6c8c4fc598D46643b1c43D2660088F215C1fD8`](https://elysium.kinetiq.xyz/address/0x9C6c8c4fc598D46643b1c43D2660088F215C1fD8) |
| RamsesAdapter | [`0x78D5B6284D9D55b8c767571de2981259B66A548B`](https://elysium.kinetiq.xyz/address/0x78D5B6284D9D55b8c767571de2981259B66A548B) |
| LiquidityBookAdapter | [`0x2622d020AF94387a2A146B6a6F48209078f87172`](https://elysium.kinetiq.xyz/address/0x2622d020AF94387a2A146B6a6F48209078f87172) |

Outside venues the router uses: Uniswap V4 PoolManager `0xe2E105D3f7209A9da11F83ccf3E7398a753823F1`, Aero Slipstream factory `0xEfd7A089D3057F05189B05f74Ffcf30610c42891`, Ramses CL factory `0x29cd8852FF040CfE74fb20277A121eD1293AFb41`, Liquidity Book factory `0xF31632C73B8775e45Ce6d2539dEb008cB766D51b`, Uniswap V3 factory `0x1707327F626496A7b5b3872e7E4d2879Df7d7a9f` and Uniswap V2 factory `0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2`.

Token addresses come from the [Elysium contract list](https://elysium.kinetiq.xyz/docs/contract-addresses). Always check an address here before approving it.

Every Stoa contract above is source-verified on [Sourcify](https://repo.sourcify.dev/99901/0x104752D50ef893da579Ad813918269e09Ea17dbA), so anyone can check that the deployed bytecode matches the code. The contracts are not upgradeable. New venues can be added to the router only after a public 24-hour wait, and the source code is on [GitHub](https://github.com/StoaDex/Stoa/tree/main/contracts).
