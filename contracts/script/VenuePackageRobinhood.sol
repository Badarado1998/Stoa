// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StoaRouter} from "../src/StoaRouter.sol";

/// @notice The live Stoa deployment on Robinhood Chain (web/lib/deployments-4663.json) and the governance operations
///         that add new venue adapters to its router.
/// @dev After lockSetup the router adds a venue in two owner calls, propose → wait `delay` (1 day) → execute, and
///      the owner is a 48h TimelockController whose only proposer and executor is the 2-of-3 Safe. Both calls are
///      scheduled in one Safe transaction (MultiSendCallOnly):
///        A = router.propose(false, adapter) for each adapter, after the 48h minimum delay
///        B = router.execute(false, adapter) for each adapter, after 48h + 1 day + 1h, with A as predecessor
///      then the Safe executes A once it is ready and B once both the timelock and the router delay have passed.
///      Three Safe transactions in total, about three days end to end. web/lib/venuePackage.ts builds the same
///      operations for the admin page; test/ForkRobinhoodVenues.t.sol runs them through the real Safe.
abstract contract VenuePackageRobinhood {
    address internal constant LIVE_ROUTER = 0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5;
    address internal constant LIVE_SAFE = 0xa1a495484536c52046d07209C60059cf9613D386;
    address internal constant LIVE_TIMELOCK = 0xAC75133729d6B5d615aA696d0828dC31fcB83ed8;
    /// Safe v1.3.0 MultiSendCallOnly (canonical address, deployed on Robinhood Chain)
    address internal constant MULTISEND_CALL_ONLY = 0x40A2aCCbd92BCA938b02010E17A5b8929b49130D;
    /// extra wait on B so it is never ready before the router's own delay has passed
    uint256 internal constant MARGIN = 1 hours;

    struct Op {
        address[] targets;
        uint256[] values;
        bytes[] payloads;
        bytes32 predecessor;
        bytes32 salt;
    }

    function _ops(address router, address[] memory adapters) internal pure returns (Op memory a, Op memory b) {
        uint256 n = adapters.length;
        a.targets = new address[](n);
        a.values = new uint256[](n);
        a.payloads = new bytes[](n);
        b.targets = new address[](n);
        b.values = new uint256[](n);
        b.payloads = new bytes[](n);
        for (uint256 i; i < n; ++i) {
            a.targets[i] = router;
            b.targets[i] = router;
            a.payloads[i] = abi.encodeCall(StoaRouter.propose, (false, adapters[i]));
            b.payloads[i] = abi.encodeCall(StoaRouter.execute, (false, adapters[i]));
        }
        b.predecessor = _id(a);
    }

    /// same as TimelockController.hashOperationBatch
    function _id(Op memory o) internal pure returns (bytes32) {
        return keccak256(abi.encode(o.targets, o.values, o.payloads, o.predecessor, o.salt));
    }
}
