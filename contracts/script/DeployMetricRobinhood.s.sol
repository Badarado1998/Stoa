// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MetricAdapter, IMetricFactory, IMetricQuoter} from "../src/adapters/MetricAdapter.sol";
import {VenuePackageRobinhood} from "./VenuePackageRobinhood.sol";

/// @notice Deploys the Metric OMM adapter for the live Robinhood Chain router and writes its address to
///         deployments/4663-metric.json (committed under contracts/, so publishing it starts no web build).
///         Owner: the 48h timelock. Keeper: the keeper wallet, which keeps each swap direction's ranked pool list current
///         (script/metric-set-pools.sh). The adapter does nothing until the Safe adds it to the router through the
///         timelock (script/RolloutMetricRobinhood.s.sol, run by rollout-robinhood-venues.yml).
contract DeployMetricRobinhood is Script, VenuePackageRobinhood {
    address internal constant METRIC_FACTORY = 0x2a53833cc95548cf52c7b159110e22D3a9018f32;
    address internal constant METRIC_QUOTER = 0x3B9ea79f482094323d06064E637a7F4528560fcb;
    address internal constant KEEPER = 0xbf666e8D054935170b9f09127247905A975b3B80;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        string memory json = vm.readFile("deployments/4663.json");
        require(vm.parseJsonAddress(json, ".router") == LIVE_ROUTER, "router mismatch");
        require(vm.parseJsonAddress(json, ".timelock") == LIVE_TIMELOCK, "timelock mismatch");
        require(METRIC_FACTORY.code.length > 0 && METRIC_QUOTER.code.length > 0, "no Metric contracts");

        vm.startBroadcast();
        MetricAdapter m = new MetricAdapter(
            IMetricFactory(METRIC_FACTORY), IMetricQuoter(METRIC_QUOTER), LIVE_ROUTER, LIVE_TIMELOCK, KEEPER
        );
        vm.stopBroadcast();

        require(
            m.stoaRouter() == LIVE_ROUTER && m.owner() == LIVE_TIMELOCK && m.keeper() == KEEPER
                && address(m.factory()) == METRIC_FACTORY && address(m.quoter()) == METRIC_QUOTER,
            "wiring"
        );
        console2.log("MetricAdapter", address(m));
        vm.writeJson(vm.serializeAddress("m", "metricAdapter", address(m)), "deployments/4663-metric.json");
    }
}
