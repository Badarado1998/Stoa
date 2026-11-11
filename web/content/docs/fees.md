# Fees

What a swap costs on Stoa.

| Fee | Size | Who receives it |
| --- | --- | --- |
| Maker spread | Set by each maker's quote | The maker / pool |
| Protocol fee | 2 bps (0.02%) of the swap, on every route | Stoa's FeeDistributor contract |
| Venue fee | Uniswap's pool fee, when the swap fills there | Uniswap liquidity providers |
| Referral share | 10% of the protocol fee | The wallet that referred you |
| Network gas | Elysium gas | The network |

Example: a $1,000 swap pays $0.20 in protocol fee, of which $0.02 goes to the referrer if there is one.
