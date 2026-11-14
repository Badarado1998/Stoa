// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CLTickSpacingAdapter, ICLTickSpacingFactory} from "../src/adapters/CLTickSpacingAdapter.sol";
import {VenuesRobinhood} from "./VenuesRobinhood.sol";
import {VenuePackageRobinhood} from "./VenuePackageRobinhood.sol";

/// @notice Deploys the Aero Slipstream and Ramses V3 adapters for the live Robinhood Chain router and adds their
///         addresses to deployments/4663-venues.json (the workflow merges them into web/lib/deployments-4663.json).
///         The adapters have no owner and no admin. They do nothing until the Safe adds them to the router through the
///         timelock (VenuePackageRobinhood); the admin page shows those three steps.
contract DeployVenuesRobinhood is Script, VenuesRobinhood, VenuePackageRobinhood {
    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        string memory path = "deployments/4663.json";
        string memory json = vm.readFile(path);
        require(vm.parseJsonAddress(json, ".router") == LIVE_ROUTER, "router mismatch");

        vm.startBroadcast();
        CLTickSpacingAdapter aero = new CLTickSpacingAdapter(ICLTickSpacingFactory(AERO_CL_FACTORY), LIVE_ROUTER, aeroSpacings());
        CLTickSpacingAdapter ramses =
            new CLTickSpacingAdapter(ICLTickSpacingFactory(RAMSES_CL_FACTORY), LIVE_ROUTER, ramsesSpacings());
        vm.stopBroadcast();

        require(aero.stoaRouter() == LIVE_ROUTER && ramses.stoaRouter() == LIVE_ROUTER, "router");
        console2.log("AeroAdapter  ", address(aero));
        console2.log("RamsesAdapter", address(ramses));

        // the workflow merges this into deployments/4663.json with jq
        vm.serializeAddress("v", "aeroAdapter", address(aero));
        vm.writeJson(vm.serializeAddress("v", "ramsesAdapter", address(ramses)), "deployments/4663-venues.json");
    }
}
