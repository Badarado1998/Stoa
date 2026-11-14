// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {VenuePackageRobinhood} from "./VenuePackageRobinhood.sol";
import {SafeRunner, ISafeLite, IMultiSendLite} from "./SafeRunner.sol";

/// @notice Moves the Aero + Ramses addition on the live Robinhood Chain router one step forward, if that step is due:
///           1) schedule A (propose) and B (execute) in the 48h timelock, one Safe transaction
///           2) once A is ready: execute A (the router records the proposal and starts its 1-day wait)
///           3) once B and the router's wait are ready: execute B (both adapters go live)
///         Run it as often as you like (the workflow runs it every hour): when nothing is due it only logs the time of
///         the next step. The same Safe transactions as /admin, so a signer can also press there instead.
/// @dev Signers come from SIGNER1_PK / SIGNER2_PK (Safe owners). With two keys a step runs in one go (approveHash, then
///      execTransaction). With one key it approves and waits for another signer, on /admin or in a later run.
///      Fork testing: SIGNER1_ADDR / SIGNER2_ADDR with `--unlocked` instead of keys. Signers pay their own gas
///      (about 0.00001 ETH per step on Robinhood Chain).
contract RolloutVenuesRobinhood is SafeRunner, VenuePackageRobinhood {
    StoaRouter constant router = StoaRouter(payable(LIVE_ROUTER));
    TimelockController constant tl = TimelockController(payable(LIVE_TIMELOCK));

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        safe = ISafeLite(LIVE_SAFE);
        string memory json = vm.readFile("deployments/4663.json");
        address[] memory ads = new address[](2);
        ads[0] = vm.parseJsonAddress(json, ".aeroAdapter");
        ads[1] = vm.parseJsonAddress(json, ".ramsesAdapter");
        require(vm.parseJsonAddress(json, ".router") == LIVE_ROUTER, "router mismatch");

        if (router.isAdapter(ads[0]) && router.isAdapter(ads[1])) {
            console2.log("DONE: Aero and Ramses are in the router. Delete the signer key secrets now.");
            return;
        }
        _loadSigners();

        (Op memory a, Op memory b) = _ops(LIVE_ROUTER, ads);
        uint256 tsA = tl.getTimestamp(_id(a));
        uint256 tsB = tl.getTimestamp(_id(b));
        console2.log("now", block.timestamp);

        if (tsA == 0) {
            uint256 minDelay = tl.getMinDelay();
            bytes[] memory calls = new bytes[](2);
            calls[0] = abi.encodeCall(TimelockController.scheduleBatch, (a.targets, a.values, a.payloads, a.predecessor, a.salt, minDelay));
            calls[1] = abi.encodeCall(
                TimelockController.scheduleBatch,
                (b.targets, b.values, b.payloads, b.predecessor, b.salt, minDelay + router.delay() + MARGIN)
            );
            _safe("step 1 of 3: schedule", MULTISEND_CALL_ONLY, abi.encodeCall(IMultiSendLite.multiSend, (_pack(LIVE_TIMELOCK, calls))), 1);
        } else if (tsA > 1) {
            if (block.timestamp < tsA) return console2.log("WAIT: step 2 (propose) opens at unix time", tsA);
            _safe("step 2 of 3: propose", LIVE_TIMELOCK, abi.encodeCall(TimelockController.executeBatch, (a.targets, a.values, a.payloads, a.predecessor, a.salt)), 0);
        } else {
            uint256 eta = router.pending(router.proposalId(false, ads[0]));
            require(tsB > 1 && eta > 0, "unexpected state: check the timelock and router");
            uint256 ready = tsB > eta ? tsB : eta;
            if (block.timestamp < ready) return console2.log("WAIT: step 3 (add to router) opens at unix time", ready);
            _safe("step 3 of 3: add to router", LIVE_TIMELOCK, abi.encodeCall(TimelockController.executeBatch, (b.targets, b.values, b.payloads, b.predecessor, b.salt)), 0);
        }
    }
}
