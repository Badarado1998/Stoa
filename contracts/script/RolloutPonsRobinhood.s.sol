// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VenueRollout} from "./RolloutVenuesRobinhood.s.sol";

/// @notice Moves the Pons curve adapter addition on the live Robinhood Chain router one step forward, if that step is
///         due: schedule in the 48h timelock, propose on the router, then add it once the router's 1-day wait has
///         passed. Same three Safe transactions and signer setup as RolloutVenuesRobinhood.
contract RolloutPonsRobinhood is VenueRollout {
    function run() external {
        string memory json = vm.readFile("deployments/4663.json");
        require(vm.parseJsonAddress(json, ".router") == LIVE_ROUTER, "router mismatch");
        address[] memory ads = new address[](1);
        ads[0] = vm.parseJsonAddress(json, ".ponsAdapter");
        _rollout("the Pons curve adapter is", ads);
    }
}
