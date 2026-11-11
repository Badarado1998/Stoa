# Stoa

**The PropAMM hub on Elysium.** Makers quote prices on-chain every block; every swap is checked against Uniswap and filled where the price is best.

| Folder | What | Stack |
|---|---|---|
| [`web/`](web) | stoa.trade: 3D home, trade, pools, earn, curators, build, referrals, portfolio, docs | Next.js 15, wagmi/viem, three.js |
| [`contracts/`](contracts) | `StoaRouter`, `StoaPool`, `MakerRegistry`, `FeeDistributor`, `UniswapV2Adapter` | Solidity 0.8.28, Foundry |
| [`maker/`](maker) | Maker bot: quotes a pool every block from the Hyperliquid book, with risk limits | TypeScript, viem |
| [`web/content/docs/`](web/content/docs) | Docs in GitBook format (Git Sync → docs.stoa.trade) | Markdown |

## Quick start

```bash
# contracts
cd contracts && forge install && forge test

# web
cd web && npm install && cp .env.example .env.local && npm run dev

# maker bot
cd maker && npm install && cp .env.example .env && npm run build && DRY_RUN=1 npm start
```

## Network

Elysium mainnet, chain ID 99901. WHYPE `0xbA876237B0F021A6c6D852d6c26E107997cC5E81`, USDC `0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65`.

## Status

Pre-launch. Contracts are not audited yet; per-swap caps stay low until they are. The router covers every Elysium venue with real liquidity (Uniswap V2/V3/V4, Aero, Ramses, Liquidity Book). What is left before launch: [LAUNCH.md](LAUNCH.md).
