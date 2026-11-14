# Contributing

Thanks for helping with Stoa. This repository is private; these notes are for the team and invited contributors.

## Before you open a pull request

- **Contracts:** `forge fmt`, `forge build --sizes` and `forge test` pass. Changes to routing, fees or ownership come with tests, and with a fork test when they touch a live venue (`ELYSIUM_RPC_URL=… / ROBINHOOD_RPC_URL=… forge test --match-contract Fork`).
- **Deployed contracts are immutable.** Do not edit the source of a contract that is already deployed: write a new one and deploy it through the workflow. `src/StoaBuyback.sol` is excluded from `forge fmt` so it stays byte-identical to its verified source.
- **Web:** `npm run build` passes in `web/`, and the change works on both Elysium and Robinhood Chain.
- **Docs:** user-facing behaviour changes update `web/content/docs` in the same pull request.

## Secrets and keys

Never commit private keys, RPC keys or `.env` files. Keys live in GitHub Actions secrets and Vercel environment variables. Deployments and Safe actions run from the workflows in `.github/workflows`, with a dry run first.

## Commits

One topic per commit, an imperative summary line, and a body that says why. Mention the transaction or run when a change follows an on-chain event.
