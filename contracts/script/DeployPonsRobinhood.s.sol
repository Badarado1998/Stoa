// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {PonsCurveAdapter} from "../src/adapters/PonsCurveAdapter.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {VenuePackageRobinhood} from "./VenuePackageRobinhood.sol";

/// @notice Deploys PonsCurveAdapter for the live Robinhood Chain router and writes its address to
///         deployments/4663-pons.json (the workflow merges it into web/lib/deployments-4663.json). No owner, no admin.
///         It does nothing until the Safe adds it to the router through the timelock (RolloutPonsRobinhood).
contract DeployPonsRobinhood is Script, VenuePackageRobinhood {
    address constant PONS_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant STOA = 0x13E6993417616De724F2b337D65063f229e96718;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        string memory json = vm.readFile("deployments/4663.json");
        require(vm.parseJsonAddress(json, ".router") == LIVE_ROUTER, "router mismatch");
        require(StoaRouter(payable(LIVE_ROUTER)).whype() == WETH, "router wraps a different token");

        vm.startBroadcast();
        PonsCurveAdapter pons = new PonsCurveAdapter(PONS_FACTORY, WETH, LIVE_ROUTER);
        vm.stopBroadcast();

        require(pons.stoaRouter() == LIVE_ROUTER && pons.weth() == WETH && pons.factory() == PONS_FACTORY, "args");
        console2.log("PonsCurveAdapter", address(pons));
        console2.log("$STOA curve      ", address(pons.curveOf(STOA)));
        vm.writeJson(vm.serializeAddress("p", "ponsAdapter", address(pons)), "deployments/4663-pons.json");
    }
}
