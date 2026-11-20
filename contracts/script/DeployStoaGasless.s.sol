// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {StoaGasless} from "../src/tools/StoaGasless.sol";

/// @notice Deploys StoaGasless (swaps without gas: the trader signs, a relayer submits) on Robinhood Chain against the live
///         router. Standalone: no owner, no settings, nothing in governance changes.
contract DeployStoaGasless is Script {
    address constant LIVE_ROUTER = 0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5;

    function run() external returns (StoaGasless g) {
        require(block.chainid == 4663, "Robinhood Chain only");
        vm.startBroadcast();
        g = new StoaGasless(StoaRouter(payable(LIVE_ROUTER)));
        vm.stopBroadcast();
        require(address(g.router()) == LIVE_ROUTER, "router");
        vm.writeJson(vm.serializeAddress("s", "gasless", address(g)), "deployments/4663-gasless.json");
        console2.log("StoaGasless", address(g));
    }
}
