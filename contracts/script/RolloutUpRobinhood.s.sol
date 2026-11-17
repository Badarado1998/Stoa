// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VenueRollout} from "./RolloutVenuesRobinhood.s.sol";

/// @notice Moves the up. adapter's addition to the live Robinhood Chain router one step forward, if that step is due:
///         schedule in the 48h timelock, propose on the router, add it after the router's 1-day wait. Same Safe
///         transactions as the Aero + Ramses and Metric rollouts; rollout-robinhood-venues.yml runs it once
///         deployments/4663-up.json exists.
contract RolloutUpRobinhood is VenueRollout {
    function run() external {
        require(vm.parseJsonAddress(vm.readFile("deployments/4663.json"), ".router") == LIVE_ROUTER, "router mismatch");
        address[] memory ads = new address[](1);
        ads[0] = vm.parseJsonAddress(vm.readFile("deployments/4663-up.json"), ".upAdapter");
        _rollout("up. is", ads);
    }
}
