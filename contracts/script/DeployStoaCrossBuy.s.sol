// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {StoaCrossBuy} from "../src/tools/StoaCrossBuy.sol";

/// @notice Deploys StoaCrossBuy on Robinhood Chain against the live router. Standalone: no owner, no settings,
///         nothing in governance changes.
contract DeployStoaCrossBuy is Script {
    address constant LIVE_ROUTER = 0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5;

    function run() external returns (StoaCrossBuy cb) {
        require(block.chainid == 4663, "Robinhood Chain only");
        vm.startBroadcast(vm.envUint("ROBINHOOD_DEPLOYER_PRIVATE_KEY"));
        cb = new StoaCrossBuy(StoaRouter(payable(LIVE_ROUTER)));
        vm.stopBroadcast();
        require(address(cb.router()) == LIVE_ROUTER, "router");
        console2.log("StoaCrossBuy", address(cb));
    }
}
