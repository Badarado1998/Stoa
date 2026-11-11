# Price providers

Each pool names the source its maker uses to price quotes.

- **HyperCore orderbook** — Elysium can read Hyperliquid's orderbook directly from a contract after the HyperCore upgrade, expected about four weeks after the 9 Nov 2026 mainnet.
- **Hyperliquid API** — used at launch by Stoa's own maker until the upgrade is live.
- **Oracle feeds** — for assets with a trusted on-chain feed.
- **A maker's own model** — for curators running custom strategies.

Pools read prices through one replaceable interface, so moving from the API to the HyperCore precompile is a single update.
