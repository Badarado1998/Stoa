# Stoa web app

Next.js 15 (App Router) + wagmi/viem + three.js. Elysium (chain 99901).

| Route | What it does |
|---|---|
| `/` | 3D "Walk the Stoa" journey (three.js, scroll-driven), generated ambient sound |
| `/trade` | Live swaps through `StoaRouter`: quote (`quoteBest`), approve, swap. Native HYPE in/out, HYPE⇄WHYPE wrap, token import by address, slippage, referral from `?ref=` |
| `/pools` | Pool list + live maker quote of the WHYPE/USDC pool |
| `/earn` | Vaults (disabled until after the audit) |
| `/curators`, `/build` | Curator guide, code samples, contract addresses |
| `/referrals` | Referral link + claim from `FeeDistributor` |
| `/portfolio` | Balances and referral earnings |
| `/docs/*` | Docs rendered from `content/docs/*.md` |

## Setup

```
npm install
cp .env.example .env.local   # RPC + contract addresses after deploy
npm run dev
```

Without `NEXT_PUBLIC_ROUTER` the app shows "not deployed yet" and only wrapping HYPE works.
WalletConnect appears when `NEXT_PUBLIC_WC_PROJECT_ID` is set (free project id from Reown); browser wallets (MetaMask, Rabby, OKX) work without it.

## Docs = GitBook

`content/docs` is a GitBook-ready folder (`SUMMARY.md`, `README.md`, one `.md` per page, GitBook `{% hint %}` blocks).
Connect it to GitBook with Git Sync (project directory `content/docs`) to publish stoadex.com/docs. The site renders the same files.

## Tests

```
npm test                 # swap helpers (amount parsing, slippage, routing kind, referral)
./scripts/ui-e2e.sh      # anvil + contracts + built app + headless browser:
                         # connect wallet, approve, USDC→HYPE swap with referral, HYPE→imported token swap
```
`ui-e2e.sh` needs Foundry and `../contracts`.

## Deploy (Vercel)

Import the repo in Vercel, set the env vars from `.env.example`, deploy. Point stoadex.com at the project.
