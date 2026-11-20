// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {StoaAutoInvest} from "../src/tools/StoaAutoInvest.sol";

/// @notice Deploys StoaAutoInvest (recurring buys, funds stay in the owner's wallet) on Robinhood Chain against the
///         live router. Standalone: no owner, no settings, nothing in governance changes. The deployer's address is
///         recorded as the runner the app names in new plans (the keeper, script/autoinvest.sh).
contract DeployStoaAutoInvest is Script {
    address constant LIVE_ROUTER = 0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5;

    function run() external returns (StoaAutoInvest ai) {
        require(block.chainid == 4663, "Robinhood Chain only");
        vm.startBroadcast();
        ai = new StoaAutoInvest(StoaRouter(payable(LIVE_ROUTER)));
        vm.stopBroadcast();
        require(address(ai.router()) == LIVE_ROUTER, "router");
        vm.serializeAddress("s", "autoInvestRunner", msg.sender);
        vm.writeJson(vm.serializeAddress("s", "autoInvest", address(ai)), "deployments/4663-autoinvest.json");
        console2.log("StoaAutoInvest", address(ai));
    }
}
