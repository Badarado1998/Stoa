// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VenueRollout} from "./RolloutVenuesRobinhood.s.sol";

/// @notice Moves the Metric adapter's addition to the live Robinhood Chain router one step forward, if that step is
///         due: schedule in the 48h timelock, propose on the router, add it after the router's 1-day wait. Same Safe
///         transactions as the Aero + Ramses rollout; rollout-robinhood-venues.yml runs it once
///         deployments/4663-metric.json exists.
contract RolloutMetricRobinhood is VenueRollout {
    function run() external {
        require(vm.parseJsonAddress(vm.readFile("deployments/4663.json"), ".router") == LIVE_ROUTER, "router mismatch");
        address[] memory ads = new address[](1);
        ads[0] = vm.parseJsonAddress(vm.readFile("deployments/4663-metric.json"), ".metricAdapter");
        _rollout("Metric is", ads);
    }
}
