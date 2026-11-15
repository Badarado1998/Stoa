// What Stoa shipped, newest first. Dates are UTC+7 (WIB), the team's time zone.
// Keep entries factual: say "scheduled" for anything still waiting on the timelock.

export type Change = {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  tag: "Robinhood Chain" | "Elysium" | "$STOA" | "Both chains";
  items: string[];
  link?: { href: string; label: string };
};

export const CHANGES: Change[] = [
  {
    id: "graduations-backfill-usdg",
    date: "2026-11-15",
    title: "More Pons graduations route, Add pool on token pages",
    tag: "Robinhood Chain",
    items: [
      "Earlier Pons graduations, up to about 12 days back, are now registered on Stoa's Uniswap V4 adapter too, not just the last day's.",
      "Launches priced in USDG graduate to a USDG pool: the watcher now registers those too, and they trade on Stoa from USDG. Launches priced in other tokens (stock tokens and the like) stay on Pons.",
      "A graduated token whose pool is not in the router yet shows an Add pool button on its page: one small transaction, open to anyone.",
      "The sitemap lists the token pages of the launches closest to graduation and of recent graduations, refreshed every hour.",
    ],
    link: { href: "/launches", label: "Open Launches" },
  },
  {
    id: "launch-pages-live-prices",
    date: "2026-11-15",
    title: "A page for every Pons launch, live prices",
    tag: "Robinhood Chain",
    items: [
      "Every Pons launch has its own page, stoadex.com/launches/<address>: curve progress, price, market cap, creator tax and a Trade or Pons button, refreshed every 10 seconds. Its link card on X and Telegram shows the token's logo and progress.",
      "Share links from Launches open the token's page and still carry the sharer's referral.",
      "Live numbers: curve progress and market cap on Launches, and the latest point of the $STOA chart, are read from the curves every 10 seconds instead of a CDN copy that could be a few minutes old. The supply API is at most a minute old.",
      "The $STOA page is ready for graduation: once $STOA moves to Uniswap V4, its market cap comes from Stoa's best quote.",
      "The graduation watcher also creates $STOA's graduation pool if its curve fills without one (a step anyone may take through the Pons factory), then registers it. Tested end to end on a fork of Robinhood Chain: $STOA routes from ETH and from USDG right after.",
    ],
    link: { href: "/launches", label: "Open Launches" },
  },
  {
    id: "pons-graduations-routed",
    date: "2026-11-15",
    title: "Every Pons graduation routes on Stoa",
    tag: "Robinhood Chain",
    items: [
      "The graduation watcher now registers the Uniswap V4 pool of every Pons token that graduates, not just $STOA, so they trade on Stoa without anyone pressing Add pool. Only the pool Pons creates at graduation, at most 10 per run.",
      "Launches: search by name, ticker or address; sort by closest to graduation, newest or market cap; an 80%+ filter; a live link preview with the three curves closest to graduation.",
      "New guide: Trade Pons tokens on Stoa (curve and graduated stages, costs, what is left to Pons, risks).",
    ],
    link: { href: "/launches", label: "Open Launches" },
  },
  {
    id: "open-source-and-price-chart",
    date: "2026-11-15",
    title: "Source code public, $STOA chart, share links",
    tag: "Both chains",
    items: [
      "The full repository is public: github.com/StoaDex/Stoa (contracts, tests, deploy scripts, web app), linked from the footer and the contracts page.",
      "$STOA page: market cap since launch, rebuilt from every buy and sell on the Pons curve.",
      "Launches: share buttons; links carry the sharer's referral. Referrals now claims fees in any token, not just the two base tokens.",
      "New guide: How to buy $STOA. Swap screen suggests going through the stablecoin when two tokens have no direct route.",
    ],
    link: { href: "/token", label: "Open the $STOA page" },
  },
  {
    id: "pons-launches-page",
    date: "2026-11-15",
    title: "Pons launches page",
    tag: "Robinhood Chain",
    items: [
      "New Launches page: every Pons token on its bonding curve that raised at least 0.05 ETH in the last few days, by ETH raised, with curve progress, market cap, creator tax and age, plus recent graduations.",
      "Read straight from the Pons factory and curves once a minute (/api/pons/launches). Until the Pons curve adapter is live (18 Nov), the buttons open Pons; after that they open a Stoa swap.",
    ],
    link: { href: "/launches", label: "Open Launches" },
  },
  {
    id: "pons-curve-adapter",
    date: "2026-11-15",
    title: "Pons bonding curves on Stoa",
    tag: "Robinhood Chain",
    items: [
      "PonsCurveAdapter deployed and source-verified: Stoa can trade tokens still on their Pons launch curve, $STOA included, directly with ETH or from any token through WETH.",
      "Quotes use the curve's own pricing (Pons' 1% fee, the token's creator tax, x·y=k), matched to the wei on the live $STOA curve and four other live curves. The buy that would graduate a curve is left to Pons.",
      "Adding it to the router goes through the Safe and the 48h timelock (scheduled, expected live 18 Nov). From then the weekly buyback can buy $STOA before it graduates.",
    ],
    link: { href: "/docs/trade", label: "How curve trades work" },
  },
  {
    id: "stoa-curve-and-supply",
    date: "2026-11-15",
    title: "$STOA curve progress and supply API",
    tag: "$STOA",
    items: [
      "The $STOA page shows live progress on the Pons bonding curve: ETH raised against the 4.2 ETH graduation threshold, read from the curve contract.",
      "Public supply endpoints for trackers: /api/stoa/supply (JSON), /api/stoa/total-supply and /api/stoa/circulating-supply (plain numbers).",
      "Circulating supply counts everything minted, minus burned $STOA and the unsold $STOA still on the curve.",
      "Once $STOA graduates, anyone can add its Uniswap V4 pool to the router from the $STOA page or the swap screen, without waiting for the watcher.",
    ],
    link: { href: "/token", label: "Open the $STOA page" },
  },
  {
    id: "stoa-buyback-and-bonds",
    date: "2026-11-15",
    title: "$STOA buyback & burn and maker bonds",
    tag: "$STOA",
    items: [
      "StoaBuyback deployed on Robinhood Chain. Protocol fees can only be swapped to $STOA through the Stoa router and burned; the contract refuses any other withdrawal.",
      "Handing the fee contract to StoaBuyback goes through the 48h timelock (scheduled, executes 17 Nov). A weekly keeper then runs the buyback once $STOA has a route.",
      "BondRegistry deployed: makers bond $STOA to quote Stoa pools. Slashed bonds are burned; unbonding takes 3 days.",
      "New $STOA page with buyback status, burn history and bond controls.",
    ],
    link: { href: "/token", label: "Open the $STOA page" },
  },
  {
    id: "robinhood-aero-ramses",
    date: "2026-11-15",
    title: "Aero Slipstream and Ramses V3 adapters",
    tag: "Robinhood Chain",
    items: [
      "Adapters for Aero Slipstream and Ramses V3 concentrated-liquidity pools deployed and source-verified.",
      "Adding them to the router goes through the Safe and the 48h timelock in three rounds (scheduled, expected live 18 Nov). The app shows them as soon as the router accepts them.",
    ],
    link: { href: "/docs/contracts", label: "Contract addresses" },
  },
  {
    id: "robinhood-pools",
    date: "2026-11-15",
    title: "Pools page and trade links on Robinhood Chain",
    tag: "Robinhood Chain",
    items: [
      "Pools page lists the pools the router actually uses, with liquidity and volume. Each pool links straight to a pre-filled trade.",
      "Trade links take ?chain=, ?sell= and ?buy= (symbol or address).",
      "Swaps send a gas limit with headroom over the node's estimate. First mainnet swaps on Robinhood Chain (ETH → USDG → ETH) went through after this change.",
      "Dedicated RPCs for reads, with the public RPC kept for log scans.",
    ],
    link: { href: "/pools?chain=robinhood", label: "Open Pools" },
  },
  {
    id: "robinhood-launch",
    date: "2026-11-14",
    title: "Stoa on Robinhood Chain",
    tag: "Robinhood Chain",
    items: [
      "Router with Uniswap V2, V3 and V4 adapters deployed on Robinhood Chain, owned by a 2-of-3 Safe through a 48h timelock.",
      "One app for Elysium and Robinhood Chain, with a network switcher and official network logos.",
      "Robinhood Chain token list with real logos.",
    ],
    link: { href: "/trade?chain=robinhood", label: "Trade on Robinhood Chain" },
  },
  {
    id: "stoa-token-launch",
    date: "2026-11-14",
    title: "$STOA launched on Pons",
    tag: "$STOA",
    items: [
      "Official $STOA launched on Pons by the dev wallet. CA: 0x13E6993417616De724F2b337D65063f229e96718.",
      "The CA is pinned on the home page, footer and $STOA page, rendered on the server.",
      "A watcher registers the $STOA pool on the router after it graduates from the Pons curve. Until then the app links to Pons.",
    ],
    link: { href: "/token", label: "About $STOA" },
  },
  {
    id: "token-prices",
    date: "2026-11-13",
    title: "Live prices in the token list",
    tag: "Both chains",
    items: [
      "USD prices and 24h change in the token list, and the USD value under swap amounts (display only).",
      "Copycat tokens with look-alike symbols are dropped from the token menu.",
    ],
  },
  {
    id: "elysium-governance",
    date: "2026-11-12",
    title: "Admin Safe and 48h timelock on Elysium",
    tag: "Elysium",
    items: [
      "Every contract is owned by a 2-of-3 admin Safe through a 48h TimelockController.",
      "Internal security review published: no critical or high findings. Stoa has not had an external audit.",
      "Hourly health check of the site, router and deployer balance; failures open an issue.",
    ],
    link: { href: "/docs/admin", label: "Admin & security" },
  },
  {
    id: "elysium-mainnet",
    date: "2026-11-12",
    title: "Stoa live on Elysium mainnet",
    tag: "Elysium",
    items: [
      "Router, adapters and maker pools deployed on Elysium and source-verified on Sourcify.",
      "Web app live at stoadex.com, with WalletConnect and verified bridged tokens.",
      "Daily refresh of routable Uniswap V4 pools and bridged tokens.",
    ],
    link: { href: "/docs/contracts", label: "Contract addresses" },
  },
];

export function changeDate(d: string) {
  return new Date(`${d}T00:00:00+07:00`);
}

export function fmtDate(d: string) {
  return changeDate(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}
