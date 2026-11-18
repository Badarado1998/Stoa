// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {VenueRollout} from "./RolloutVenuesRobinhood.s.sol";
import {ISafeLite, IMultiSendLite} from "./SafeRunner.sol";

/// @notice Swaps the live router's Uniswap V3, Aero and Ramses adapters for their gas-capped V2s and adds up. through
///         its gas-capped adapter, one step per call when due, through the same Safe and 48h timelock as the other
///         rollouts:
///           1) schedule A (router.propose for the four new adapters) and B (router.execute for the four, plus
///              router.removeAdapter for the three old ones), one Safe tx
///           2) once A is ready: execute A (the router starts its 1-day wait)
///           3) once B and the router's wait are ready: execute B, so the new adapters go in and the old ones go out in
///              the same transaction (no gap in routing)
///         rollout-robinhood-venues.yml runs it once deployments/4663-simgas.json exists.
contract RolloutSimGasRobinhood is VenueRollout {
    address internal constant OLD_V3 = 0x28802Ad6F9859d14dfC6226eA9A8b60686D3A2E6;
    address internal constant OLD_AERO = 0xF0904B95D66f565De215cC7dc58B6054F72A9352;
    address internal constant OLD_RAMSES = 0x87b3B896beAbdC421F9d9B0A3FD3dBbAE1ddd568;

    function _new() internal view returns (address[] memory ads) {
        string memory j = vm.readFile("deployments/4663-simgas.json");
        ads = new address[](4);
        ads[0] = vm.parseJsonAddress(j, ".uniswapV3AdapterV2");
        ads[1] = vm.parseJsonAddress(j, ".aeroAdapterV2");
        ads[2] = vm.parseJsonAddress(j, ".ramsesAdapterV2");
        ads[3] = vm.parseJsonAddress(j, ".upAdapterV2");
    }

    /// @dev A and B as scheduled; exposed for tests and for the message to reviewers
    function ops() public view returns (Op memory a, Op memory b) {
        address[] memory ads = _new();
        (a, b) = _ops(LIVE_ROUTER, ads);
        address[3] memory old = [OLD_V3, OLD_AERO, OLD_RAMSES];
        uint256 n = b.targets.length;
        address[] memory t = new address[](n + 3);
        uint256[] memory v = new uint256[](n + 3);
        bytes[] memory p = new bytes[](n + 3);
        for (uint256 i; i < n; ++i) {
            (t[i], p[i]) = (b.targets[i], b.payloads[i]);
        }
        for (uint256 i; i < 3; ++i) {
            (t[n + i], p[n + i]) = (LIVE_ROUTER, abi.encodeCall(StoaRouter.removeAdapter, (old[i])));
        }
        (b.targets, b.values, b.payloads) = (t, v, p);
    }

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        require(vm.parseJsonAddress(vm.readFile("deployments/4663.json"), ".router") == LIVE_ROUTER, "router mismatch");
        address[] memory ads = _new();
        safe = ISafeLite(LIVE_SAFE);
        bool done = !router.isAdapter(OLD_V3) && !router.isAdapter(OLD_AERO) && !router.isAdapter(OLD_RAMSES);
        for (uint256 i; i < ads.length; ++i) {
            if (!router.isAdapter(ads[i])) done = false;
        }
        if (done) {
            console2.log("DONE: the gas-capped V3, Aero, Ramses and up. adapters are in the router.");
            return;
        }
        _loadSigners();

        (Op memory a, Op memory b) = ops();
        uint256 tsA = tl.getTimestamp(_id(a));
        uint256 tsB = tl.getTimestamp(_id(b));
        console2.log("Gas-capped adapters - now", block.timestamp);
        console2.log("operation A id");
        console2.logBytes32(_id(a));
        console2.log("operation B id");
        console2.logBytes32(_id(b));

        if (tsA == 0) {
            uint256 minDelay = tl.getMinDelay();
            bytes[] memory calls = new bytes[](2);
            calls[0] = abi.encodeCall(
                TimelockController.scheduleBatch, (a.targets, a.values, a.payloads, a.predecessor, a.salt, minDelay)
            );
            calls[1] = abi.encodeCall(
                TimelockController.scheduleBatch,
                (b.targets, b.values, b.payloads, b.predecessor, b.salt, minDelay + router.delay() + MARGIN)
            );
            _safe(
                "step 1 of 3: schedule",
                MULTISEND_CALL_ONLY,
                abi.encodeCall(IMultiSendLite.multiSend, (_pack(LIVE_TIMELOCK, calls))),
                1
            );
        } else if (tsA > 1) {
            if (block.timestamp < tsA) return console2.log("WAIT: step 2 (propose) opens at unix time", tsA);
            _safe(
                "step 2 of 3: propose",
                LIVE_TIMELOCK,
                abi.encodeCall(
                    TimelockController.executeBatch, (a.targets, a.values, a.payloads, a.predecessor, a.salt)
                ),
                0
            );
        } else {
            uint256 eta = router.pending(router.proposalId(false, ads[0]));
            require(tsB > 1 && eta > 0, "unexpected state: check the timelock and router");
            uint256 ready = tsB > eta ? tsB : eta;
            if (block.timestamp < ready) return console2.log("WAIT: step 3 (swap adapters) opens at unix time", ready);
            _safe(
                "step 3 of 3: swap adapters",
                LIVE_TIMELOCK,
                abi.encodeCall(
                    TimelockController.executeBatch, (b.targets, b.values, b.payloads, b.predecessor, b.salt)
                ),
                0
            );
        }
    }
}
