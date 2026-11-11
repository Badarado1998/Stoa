# Audits

Audit status for Stoa contracts.

Stoa contracts have **not been audited yet**. An external audit is planned before swap and pool caps are raised or vaults open. Reports will be linked on this page.

## What has been done

- 45 unit and attack tests, plus fork tests that run the router against live Elysium mainnet pools
- Static analysis with Slither; every finding is triaged in [SECURITY.md](https://github.com/StoaDex/Stoa/blob/main/contracts/SECURITY.md)
- Contracts are not upgradeable: the code you see is the code that runs
