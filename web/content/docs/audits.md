# Audits

Audit status for Stoa contracts.

Stoa contracts have **not been audited yet**. An external audit is planned before swap and pool caps are raised or vaults open. Reports will be linked on this page.

## What has been done

- 57 unit and attack tests, plus 11 fork tests that run the router against live Elysium mainnet pools on every change
- Static analysis with Slither, with every finding triaged
- Every deployed contract is source-verified on [Sourcify](https://repo.sourcify.dev/99901/0x104752D50ef893da579Ad813918269e09Ea17dbA)
- Admin powers and their limits are listed in [Admin and permissions](admin.md)
- Contracts are not upgradeable: the code you see is the code that runs
