// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CLTickSpacingAdapter, ICLTickSpacingFactory} from "../src/adapters/CLTickSpacingAdapter.sol";
import {UpVenueRobinhood} from "./UpVenueRobinhood.sol";

/// @notice Deploys the up. adapter (a CLTickSpacingAdapter, the same reviewed code as the Aero and Ramses adapters)
///         for the live Robinhood Chain router and writes its address to deployments/4663-up.json. It has no owner and
///         no admin, and does nothing until the router adds it through the 48h timelock (RolloutUpRobinhood).
contract DeployUpRobinhood is Script, UpVenueRobinhood {
    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        require(
            vm.parseJsonAddress(vm.readFile("deployments/4663.json"), ".router") == UP_LIVE_ROUTER, "router mismatch"
        );
        vm.startBroadcast();
        CLTickSpacingAdapter up =
            new CLTickSpacingAdapter(ICLTickSpacingFactory(UP_CL_FACTORY), UP_LIVE_ROUTER, upSpacings());
        vm.stopBroadcast();
        require(up.stoaRouter() == UP_LIVE_ROUTER && address(up.factory()) == UP_CL_FACTORY, "config");
        console2.log("UpAdapter", address(up));
        vm.writeJson(vm.serializeAddress("u", "upAdapter", address(up)), "deployments/4663-up.json");
    }
}
