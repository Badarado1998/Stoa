# Fees

What a swap costs on Stoa.

| Fee | Size | Who receives it |
| --- | --- | --- |
| Maker spread | Set by each maker's quote | The maker / pool |
| Protocol fee | 2 bps (0.02%) of the swap, on every route | Stoa's FeeDistributor contract |
| Venue fee | The outside pool's fee, when the swap fills on Uniswap, Aero, Ramses or Liquidity Book | That venue's liquidity providers |
| Referral share | 10% of the protocol fee | The wallet that referred you |
| Network gas | Elysium gas | The network |

The protocol fee is charged once per swap, even when a route has two legs: by the Stoa pool if the route uses one, otherwise by the router.

Example: a $1,000 swap pays $0.20 in protocol fee, of which $0.02 goes to the referrer if there is one.

On Robinhood Chain the protocol's share buys $STOA every week and burns it: see [$STOA](token.md).
