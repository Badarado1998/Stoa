# Launch checklist

Everything in code is done and tested (unit, attack, live fork tests on Elysium, UI end-to-end on a local mainnet fork). What is left needs the owner's accounts, money or keys. Do it in this order.

## 1. Wallets

- [ ] **Owner**: a hardware wallet (Ledger/Trezor) for launch. It owns the router, registry, fee distributor, the maker pool and the V4 adapter, and can pause, remove venues and withdraw protocol fees. Address goes in `OWNER`. Safe v1.3.0 contracts exist on Elysium, but check that the Safe app supports Elysium before using one; ownership can move to a Safe later with `transferOwnership` + `acceptOwnership`.
- [ ] **Treasury** address (can be the same Safe). Receives slashed bonds. Goes in `TREASURY`.
- [ ] **Deployer** = a fresh wallet used only to deploy, with ~0.05 HYPE for gas (the dry run prints the exact gas). Never the owner.
- [ ] Optional **guardian**: a separate hot wallet that can only pause swaps, for fast reaction. Goes in `GUARDIAN` (defaults to `OWNER`).

## 2. GitHub (repo → Settings)

- [ ] Secrets → Actions: `DEPLOYER_PRIVATE_KEY` (the deployer's key). `ELYSIUM_RPC_URL` is optional; the public Kinetiq RPC is used if missing.
- [ ] Variables → Actions: `OWNER`, `TREASURY`; optional `GUARDIAN`, `CURATOR`, `MAKER`, `MIN_BOND`, `MAX_SWAP_USDC`, `ROUTER_DELAY`.
- [ ] Rules → Rulesets → New branch ruleset on `main`: target the default branch, enable **Restrict deletions** and **Block force pushes**. Leave pull requests and status checks off so the deploy bot can commit addresses. (Rulesets on private repos need GitHub Pro; on Free, make the repo public or skip.)

## 3. Deploy

- [ ] Actions → **Deploy contracts** → Run workflow, *broadcast unticked* (dry run). Check the printed addresses, gas and warnings.
- [ ] Run again with **broadcast ticked**. The workflow commits `web/lib/deployments.json`; Vercel redeploys the site with the live addresses.
- [ ] Open `stoa.trade/admin` with the owner wallet and press **Accept** on StoaRouter, MakerRegistry and FeeDistributor. The same page pauses swaps, withdraws protocol fees, approves makers and proposes venues.
- The deploy also registers the 60 most traded Uniswap V4 launchpad pools (`contracts/script/data/v4-seed-pools.json`), so they route on day one. Rerun later with Actions → **Seed Uniswap V4 pools**.
- [ ] Optional: verify the contracts on the Kinetiq explorer.

## 4. Web (Vercel → Project → Settings)

- [ ] Domains: buy `stoa.trade` and add it to the Vercel project; set `NEXT_PUBLIC_SITE_URL=https://stoa.trade`.
- [ ] `NEXT_PUBLIC_WC_PROJECT_ID`: create a free project at cloud.reown.com (WalletConnect), allow the domain `stoa.trade`. Without it, only browser-extension wallets can connect.
- [ ] `NEXT_PUBLIC_RPC_URL`: in the Alchemy and dRPC dashboards, restrict both keys to the `stoa.trade` domain, because these keys are visible in the browser.
- Note: Vercel Authentication only guards the `*.vercel.app` URLs; `stoa.trade` is public once the domain is added.

## 5. After launch

- [ ] New launchpad tokens: anyone can add their V4 pool from the Trade page; refresh the seed list now and then with `contracts/script/data/v4_top_pools.py`.
- [ ] Maker bot: when there is capital for the WHYPE/USDC pool, fund the pool, approve and bond the maker (`setMakerApproval`, `bond`), and run `maker/` on a server.
- [ ] Bug bounty and an external audit before raising the $500 per-swap cap.
- [ ] When swap volume grows, move swap history and stats from direct log reads to an indexer.
