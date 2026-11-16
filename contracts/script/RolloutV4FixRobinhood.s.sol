// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {VenueRollout} from "./RolloutVenuesRobinhood.s.sol";
import {ISafeLite, IMultiSendLite} from "./SafeRunner.sol";

/// @notice Swaps the live router's Uniswap V4 adapter for UniswapV4AdapterV2 (keeper-only pool registration), one step
///         per call when due, through the same Safe and 48h timelock as the other rollouts:
///           1) schedule A (router.propose V2) and B (router.execute V2 + router.removeAdapter old), one Safe tx
///           2) once A is ready: execute A (the router starts its 1-day wait)
///           3) once B and the router's wait are ready: execute B, so V2 goes in and the old adapter goes out in the
///              same transaction (no gap without Uniswap V4 routing)
///         rollout-robinhood-venues.yml runs it once deployments/4663-fixes.json exists.
contract RolloutV4FixRobinhood is VenueRollout {
    address internal constant OLD_V4 = 0x8965140Fb51b2E99a0Cd31a0E99Eae01D36517B8;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        require(vm.parseJsonAddress(vm.readFile("deployments/4663.json"), ".router") == LIVE_ROUTER, "router mismatch");
        address v2 = vm.parseJsonAddress(vm.readFile("deployments/4663-fixes.json"), ".uniswapV4AdapterV2");
        safe = ISafeLite(LIVE_SAFE);
        if (router.isAdapter(v2) && !router.isAdapter(OLD_V4)) {
            console2.log("DONE: the V4 adapter swap is in the router.");
            return;
        }
        _loadSigners();

        address[] memory ads = new address[](1);
        ads[0] = v2;
        (Op memory a, Op memory b) = _ops(LIVE_ROUTER, ads);
        // B also removes the old adapter, in the same timelock batch as adding V2
        address[] memory t = new address[](2);
        uint256[] memory v = new uint256[](2);
        bytes[] memory p = new bytes[](2);
        (t[0], p[0]) = (b.targets[0], b.payloads[0]);
        (t[1], p[1]) = (LIVE_ROUTER, abi.encodeCall(StoaRouter.removeAdapter, (OLD_V4)));
        (b.targets, b.values, b.payloads) = (t, v, p);

        uint256 tsA = tl.getTimestamp(_id(a));
        uint256 tsB = tl.getTimestamp(_id(b));
        console2.log("The V4 adapter swap - now", block.timestamp);

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
            uint256 eta = router.pending(router.proposalId(false, v2));
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
