# Internal security review

A review of the deployed contracts by the Stoa team, published in full. **This is not an external audit.** An independent audit is still planned before caps rise or vaults open.

## Scope

| Item | Value |
| --- | --- |
| Date | 12 November 2026 |
| Contracts | StoaRouter, StoaPool, MakerRegistry, FeeDistributor, and the six venue adapters (Uniswap V2, V3, V4, Aero, Ramses, Liquidity Book) |
| Code | As deployed on Elysium mainnet and verified on [Sourcify](https://repo.sourcify.dev/99901/0x104752D50ef893da579Ad813918269e09Ea17dbA) |
| Size | About 1,760 lines of Solidity 0.8.28, OpenZeppelin 5.1 |

## Method

- Line-by-line reading of every swap, quote, bond, fee and admin path
- Static analysis with Slither (76 detectors); every result triaged below
- 57 unit and attack tests and 11 fork tests against live Elysium pools
- Two mainnet test swaps through the production router (HYPE to USDC and back), both successful

## Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 3 |
| Informational | 4 |

No issue allows anyone to take user funds. The two medium findings are about admin trust, not code bugs.

## Findings

### M-1 Admin is a single wallet

**Status: acknowledged.** The owner and guardian of every contract is one wallet. If its key leaks, an attacker could pause swaps, withdraw maker pool inventory, slash maker bonds or propose a new venue. They could **not** upgrade code, move funds from user wallets, or add a venue without the 24-hour public wait, which gives time to react. **Update:** a 2-of-3 admin Safe is deployed (`0xBF715C84b1C0759C87Da368c1476b80ac0C5055F`) and ownership is moving to it; the router guardian stays a single wallet that can only pause. See [Admin and permissions](admin.md).

### M-2 Owner can withdraw maker pool inventory

**Status: by design for now.** Maker pool inventory is supplied by Stoa itself, so this is how it is managed. Before any outside deposits are accepted, pool inventory moves into vaults the owner cannot withdraw from. Vaults stay closed until the external audit.

### L-1 A quote outlives a maker's removal for up to 2 blocks

A pool checks the maker's approval and bond when a quote is posted, not on each swap. If a maker is removed or starts unbonding, its last quote stays valid until it expires, at most 2 blocks (about 200–400 ms). The owner or guardian can cancel a quote at once, and a bond stays slashable for 24 hours after unbonding starts.

### L-2 Traders can name themselves as referrer

A trader can pass their own address as referrer and receive 10% of the protocol fee back, a rebate of 0.2 bps. This costs the protocol a little and nothing to other users. Accepted.

### L-3 Direct pool swaps accept any recipient

`StoaPool.swap` does not itself reject the zero address as recipient; standard tokens such as WHYPE and USDC revert on such a transfer anyway. It only matters to someone calling the pool directly with a mistaken recipient, never through the router or app, which always checks the recipient.

### I-1 Fee rounding

Pool and router fees are taken from an output that was already rounded down, so the fee can be off by less than one smallest unit of the token. Every rounding goes in the pool's favor; no loss to users.

### I-2 Reentrancy warnings (false positive)

Slither flags external calls before balance checks in the router and adapters. Both router swap functions, the pool swap and every bond and fee withdrawal are `nonReentrant`, and venues must be allowlisted, so these paths cannot be re-entered.

### I-3 Native HYPE sent to a caller-chosen address (by design)

The router sends native HYPE to the recipient the trader chose, after checking the output against the trader's minimum. The bond registry sends HYPE only to the maker withdrawing or to the treasury.

### I-4 V4 key list "never initialized" (false positive)

The V4 adapter's pool list is a mapping filled by `register`. Slither's warning does not apply.

## What was checked and held up

- **Input and output are measured, not trusted.** Each leg checks that the venue took exactly the input, and the final output is measured against the trader's minimum.
- **Only allowlisted venues.** Unknown venues, wrong pairs and removed venues revert. Fork tests confirm adapters reject strangers and fake callbacks.
- **Approvals.** The router pulls only the swap amount from the caller and clears any approval it gives a pool.
- **Fee accounting.** Fees must be backed by tokens the distributor actually holds, and referral earnings can only be claimed by the referrer.
- **Bonds.** Slashing takes active bond first, then pending; a maker cannot withdraw within the 24-hour delay.
- **No upgradeability.** No proxies, no self-destruct, no delegatecall to outside code.

## Next steps

1. Finish moving ownership to the 2-of-3 admin Safe.
2. External audit before raising the $500 per-swap cap or opening vaults.
3. Paid bug bounty alongside the audit. Until then, report issues by DM to [@StoaDEX](https://x.com/StoaDEX).
