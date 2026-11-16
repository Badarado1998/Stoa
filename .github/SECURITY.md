# Security policy

Stoa's contracts hold user funds only for the duration of a swap, but a bug in the router, a pool or an adapter could still cost traders money. Please report anything you find privately.

## Reporting a vulnerability

- Send a direct message to [@StoaDEX on X](https://x.com/StoaDEX) with a short description and say it is a security report. We reply with a private channel for the details.
- Please do **not** open a public GitHub issue, post on social media or exploit the issue on mainnet.
- Include the contract and chain, the steps or a Foundry test that reproduces it, and the impact you expect.

We aim to acknowledge reports within 48 hours. Stoa does not run a paid bug bounty (the program ended on 17 November 2026); valid findings are credited in the security review if the reporter wishes.

## Scope

- Contracts in [`contracts/src`](../contracts/src) as deployed on Elysium (99901) and Robinhood Chain (4663). Addresses: [stoadex.com/docs/contracts](https://stoadex.com/docs/contracts).
- The web app at stoadex.com, where a bug could make a user sign something other than what they see.

Out of scope: third-party venues (Uniswap, Aero, Ramses, Liquidity Book, Pons), token contracts we do not control, and denial of service through RPC limits.

## What protects funds today

The contracts are **not audited yet**. Design guarantees, trusted roles, known limits and the static-analysis triage are in [`contracts/SECURITY.md`](../contracts/SECURITY.md). In short: immutable code, every owner action behind a 2-of-3 Safe and a 48-hour timelock, a guardian that can only pause, output measured against the trader's `minOut` on every swap, and source verified on Sourcify.
