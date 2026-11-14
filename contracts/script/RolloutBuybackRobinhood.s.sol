// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {FeeDistributor} from "../src/FeeDistributor.sol";
import {TokenPackageRobinhood} from "./TokenPackageRobinhood.sol";
import {SafeRunner, ISafeLite} from "./SafeRunner.sol";

/// @notice Moves the FeeDistributor handover to StoaBuyback one step forward, if due:
///           1) the Safe schedules the handover batch in the 48h timelock
///           2) once ready, the Safe executes it: the buyback contract owns the FeeDistributor
///         Run it as often as you like; when nothing is due it logs the time of the next step.
contract RolloutBuybackRobinhood is SafeRunner, TokenPackageRobinhood {
    TimelockController constant tl = TimelockController(payable(LIVE_TIMELOCK));

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        safe = ISafeLite(LIVE_SAFE);
        string memory json = vm.readFile("deployments/4663.json");
        address bb = vm.parseJsonAddress(json, ".stoaBuyback");
        if (FeeDistributor(LIVE_FEES).owner() == bb) {
            console2.log("DONE: StoaBuyback owns the FeeDistributor. Protocol fees now only buy and burn $STOA.");
            return;
        }
        _loadSigners();
        Op memory o = _handoverOp(bb);
        uint256 ts = tl.getTimestamp(_id(o));
        console2.log("now", block.timestamp);
        if (ts == 0) {
            _safe(
                "buyback step 1 of 2: schedule the FeeDistributor handover",
                LIVE_TIMELOCK,
                abi.encodeCall(TimelockController.scheduleBatch, (o.targets, o.values, o.payloads, o.predecessor, o.salt, tl.getMinDelay())),
                0
            );
        } else if (ts > 1) {
            if (block.timestamp < ts) return console2.log("WAIT: buyback step 2 (handover) opens at unix time", ts);
            _safe(
                "buyback step 2 of 2: hand the FeeDistributor to StoaBuyback",
                LIVE_TIMELOCK,
                abi.encodeCall(TimelockController.executeBatch, (o.targets, o.values, o.payloads, o.predecessor, o.salt)),
                0
            );
        } else {
            revert("handover executed but the FeeDistributor has another owner: check it");
        }
    }
}
