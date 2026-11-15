# FAQ

Short answers to the questions people ask most, each with a link to the full page.

## Security

### Is Stoa audited?

Not externally, not yet. The team published its own [internal security review](security-review.md) in full, findings and fixes included. An external audit is planned before swap caps rise or liquidity vaults open, and its report will be linked on [Audits](audits.md).

### What has been checked so far?

- 102 unit and attack tests, plus fork tests that run the contracts against live venues: 23 on Robinhood Chain and 11 on Elysium.
- Slither static analysis with 102 detectors over every Stoa contract. Every High and Medium result is triaged in the review.
- A line-by-line review by the team. It found no issue that lets anyone take user funds.
- Every deployed contract is source-verified on Sourcify, and the code is open source on [GitHub](https://github.com/StoaDex/Stoa).

None of this replaces an external audit. It is what you can check today.

### Can the team take my funds?

The router cannot move anything from your wallet except the exact amount of the swap you sign, inside that swap. It does not hold funds between swaps, and it checks what you received against your minimum before the transaction can finish. The app approves only the amount of each swap unless you opt in to more.

No contract is upgradeable. Every admin action goes through a 2-of-3 Safe and then waits 48 hours in public in a timelock before it can run. All three Safe signers are held by the team, so the Safe protects against a leaked key, not against the team itself; the 48-hour public wait is what gives you time to react. See [Admin and permissions](admin.md).

### What happens if something goes wrong?

The router's guardian can pause swaps at once. It cannot unpause, move funds or change settings. Report a vulnerability privately as described on [Bug bounty](bug-bounty.md).

## Volume

### How much volume does Stoa process?

Every swap through a Stoa router is on [Stats](https://stoadex.com/stats), with its transaction, per network and per day. The numbers there are the real ones, small or large. The router went live on Elysium on 12 November 2026 and on Robinhood Chain on 14 November 2026, so it is early.

### How is it counted?

Straight from the chain: every swap that settles through a Stoa router emits one `Routed` event, and a failed swap emits nothing. Each swap counts once, on one side: the stablecoin side when there is one, otherwise the gas-token side or a DexScreener price. The team's own launch checks are included. The same data is at [/api/stats](https://stoadex.com/api/stats).

## $STOA

### What does $STOA do?

Four things, all on Robinhood Chain:

1. **Protocol fees buy and burn it.** From 17 November 2026, the 2 bps protocol fee goes to StoaBuyback, a contract whose only way to move fees out is to swap them into $STOA and burn it. A keeper runs it every Monday.
2. **Makers bond it.** A maker that quotes a Stoa pool on Robinhood Chain bonds $STOA. A slashed bond is burned, not paid to anyone.
3. **Holders vote in Spotlight.** From 23 November 2026, projects bid ETH for three sponsored slots a week, and holders who lock $STOA and vote for the winners are paid 90% of those bids. The other 10% buys $STOA and burns it.
4. **Holders back Rug Cover.** Holders who lock $STOA in Rug Cover receive 90% of the fees and forfeited bonds that Pons creators pay, in ETH. Every buyer premium buys $STOA and burns it.

Details on [$STOA](token.md).

### Do holders earn a share of fees?

No. Fees burn $STOA instead of paying holders, and bonding earns nothing by itself. Holders who lock and vote in [Spotlight](spotlight.md) can be paid ETH, but that ETH comes from projects' bids, not from Stoa's fees, and depends on what projects bid each week. Rug Cover backers are paid only from what Pons creators pay or forfeit, never from buyers' premiums or Stoa's fees. Nothing is promised.

### What is Spotlight?

A weekly market for Stoa's sponsored slots. Projects bid ETH, $STOA holders lock and vote, and the three largest bids with at least 1M $STOA of votes win. Their voters share 90% of the bids; 10% is burned; losing bids are refunded. Winners show on Trade, Launches and Tokens for a week, marked "Sponsored". Rules and risks: [Spotlight](spotlight.md).

### What is Rug Cover?

A Pons token's creator bonds ETH behind a promise not to sell or move the tokens in their wallet. If you buy the token on Stoa with cover (1% more) and the creator's wallet drops below its promise before the bond is released, you claim back the ETH you spent, from the bond. It watches only the creator's own wallet, and it is a contract rule, not insurance. Rules and limits: [Rug Cover](rug-cover.md).

### Can I install Stoa as an app?

Yes. On Android and in desktop Chrome or Edge, use **Install the app** at the bottom of any page, or the banner on Trade on your phone. On iPhone and iPad, open stoadex.com in Safari, tap Share, then **Add to Home Screen**. The app opens straight to Trade, loads fast on a weak signal, and always fetches prices and balances live.

### Is there an API for bots?

Yes: one HTTP call returns the best route and a ready-to-send swap, and your bot can earn the referral share. See [API for bots and apps](api.md).

### Does the team hold $STOA?

Yes. The team wallet on fomo holds at least 0.5% of supply, with its live balance on the [$STOA page](https://stoadex.com/token). Buys on the Pons curve also pay $STOA's 1.8% creator tax to the creator wallet set at launch. See [Team wallet](token.md).

### Where do I buy it, and which contract is real?

The only official $STOA is `0x13E6993417616De724F2b337D65063f229e96718` on Robinhood Chain. Anyone can launch a token called STOA. Step-by-step guide: [How to buy $STOA](buy-stoa.md).

## Trading

### What does a swap cost?

2 bps (0.02%) to Stoa, plus the fee of the venue that fills it. 10% of Stoa's fee goes to the referrer if you came through a referral link. Full table: [Fees](fees.md).

### How do I know I get the best price?

Under every quote, the Trade page shows what the venues on that network would give you for the same amount, read live from the chain. The router checks the same venues when you sign, fills on the best one, and reverts if you would get less than your minimum.

### Which networks and venues?

Elysium and Robinhood Chain. The venues on each are listed in the [Introduction](introduction.md).

### Do I need an account?

No. Connect any EVM wallet. There is no sign-up and no deposit.

## Contact

### How do I reach the team?

DM [@StoaDEX](https://x.com/StoaDEX) on X. See [Contact](contact.md).
