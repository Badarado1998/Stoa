# Bug bounty

Find a vulnerability in Stoa, report it privately, and get paid in stablecoins. Stoa has not had an external audit yet, so reports from security researchers matter.

## How to report

Report privately, through either channel:

- **GitHub:** [report a vulnerability](https://github.com/StoaDex/Stoa/security/advisories/new) on the StoaDex/Stoa repository. The report stays private between you and the team.
- **X:** a direct message to [@StoaDEX](https://x.com/StoaDEX). For anything above Low, send a short message first and the full details through GitHub.

A good report has the affected contract and function, the impact, and a proof of concept. A Foundry test on a fork is best: the repository's `contracts/test` folder has fork tests for both networks to start from.

Please do not disclose the issue publicly, or to anyone else, until it is fixed and the team has agreed to disclosure.

## What we pay

Rewards are paid in stablecoins: USDG on Robinhood Chain or USDC on Elysium, or USDC on another major chain if you ask.

| Severity | Examples | Reward |
| --- | --- | --- |
| Critical | Theft or permanent freezing of user funds, maker liquidity, protocol fees, bonds, bids or locked $STOA; getting around the 48-hour timelock | $2,500 |
| High | Temporary freezing of funds that the pause rules do not allow; theft of unclaimed fees, rewards, refunds or claims; a swap paying out less than the user's minimum | $1,000 |
| Medium | A contract failing to deliver what it promises without loss of funds; blocking swaps or a feature for others without a pause; griefing that costs users gas or time | $300 |
| Low | A contract or the app behaving differently from the docs with no funds at risk; the app showing a wrong address, amount or warning before you sign | Credit in the security review |

- The team decides the severity from the impact on funds on the live contracts, using these examples.
- One reward per root cause. If two people report the same issue, the first complete report is paid.
- Rewards are paid within 14 days of the team confirming the issue, to an address you give. No KYC.
- Low findings are credited in the [security review](security-review.md), with your name or anonymously, and are not paid in cash. Low reports sent before 18 November 2026 keep the $100 reward.
- The program's budget may change as the protocol grows. Changes are announced on this page and do not affect reports already sent.

## Scope

**In scope:** Stoa's own contracts on Elysium and Robinhood Chain, as listed on [Contracts](contracts.md): StoaRouter, the venue adapters, StoaPool maker pools, MakerRegistry, FeeDistributor, StoaBuyback, BondRegistry, SpotlightMarket, RugCover, StoaLimit, and how they use the timelock and the admin Safe. Also the app at [stoadex.com](https://stoadex.com), for issues that could make someone sign a harmful transaction.

**Out of scope:**

- Contracts Stoa does not control: tokens (including the $STOA token, a Pons launch), Uniswap, Aero, Ramses, Liquidity Book, Pons, Permit2, WETH, WHYPE, USDG, USDC and the Safe contracts. Report those to their teams.
- Issues that need a compromised admin key, guardian or keeper, and known limits of those roles: see [Admin and permissions](admin.md) and the findings in the [security review](security-review.md).
- Losses a user's own slippage limit allows, and prices on third-party venues.
- Denial of service against websites or RPCs, spam, missing security headers or best practices with no impact, and attacks on third-party services (RPC providers, DexScreener, Vercel, X).
- Phishing, social engineering, and anything that needs physical access to a device.

## Rules

- Test on a local fork, never against live funds. Do not touch other people's funds, and stop at the smallest proof that the issue is real.
- Do not degrade the live app or networks for other users.
- Team members and their relatives are not eligible.
- Research done in good faith under these rules is welcome: the team will not take legal action against you for it.

## What happens next

The team acknowledges a report within 48 hours and gives a first assessment within 7 days. For a live risk, the guardian can pause swaps at once while a fix goes through the timelock. Fixed issues are written up in the [security review](security-review.md), crediting the reporter if they want.
