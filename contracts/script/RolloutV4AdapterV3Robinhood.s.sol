// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {PoolKey} from "../src/adapters/UniswapV4Adapter.sol";
import {UniswapV4AdapterV3} from "../src/adapters/UniswapV4AdapterV3.sol";
import {VenueRollout} from "./RolloutVenuesRobinhood.s.sol";
import {ISafeLite, IMultiSendLite} from "./SafeRunner.sol";
import {V4AdapterV3Robinhood} from "./V4AdapterV3Robinhood.sol";

/// @notice Swaps the live router's UniswapV4AdapterV2 for UniswapV4AdapterV3, one Safe step per call when due, through
///         the same Safe and 48h timelock as the other rollouts. Starts only once the V4 fix (first adapter -> V2) is
///         DONE. rollout-robinhood-venues.yml runs it once deployments/4663-v4v3.json exists.
///           1) schedule, in one Safe tx: A (router.propose V3), B (router.execute V3 + router.removeAdapter V2) and
///              one operation per pin (V3.setPinned for each key of pinnedKeys()), each its own timelock operation
///              (Hey Research Lab, I-2: a pin reverts unless its key is registered when it runs, and a batch would
///              revert with it)
///           2) once A is ready: execute A (the router starts its 1-day wait)
///           pins) once a pin is ready and its key is registered on V3: execute it, one per Safe tx; a pin whose key
///              is missing waits (the keeper registers the keys right after the deploy) and never blocks the rest
///           3) once B and the router's wait are ready: execute B, so V3 goes in and V2 goes out in one transaction
contract RolloutV4AdapterV3Robinhood is VenueRollout, V4AdapterV3Robinhood {
    bytes32 internal constant PIN_SALT = keccak256("stoa.v4v3.pin");

    function _pinOp(address v3, PoolKey memory k) internal pure returns (bytes memory data, bytes32 salt) {
        data = abi.encodeCall(UniswapV4AdapterV3.setPinned, (k, true));
        salt = keccak256(abi.encode(PIN_SALT, k));
    }

    function _listed(UniswapV4AdapterV3 v3, PoolKey memory k) internal view returns (bool) {
        PoolKey[] memory ks = v3.keysFor(k.currency0 == address(0) ? WETH : k.currency0, k.currency1);
        bytes32 id = keccak256(abi.encode(k));
        for (uint256 i; i < ks.length; ++i) {
            if (keccak256(abi.encode(ks[i])) == id) return true;
        }
        return false;
    }

    /// @dev Executes the first pin that is ready and whose key is registered. True if it sent a Safe transaction.
    function _pins(UniswapV4AdapterV3 v3) internal returns (bool sent) {
        PoolKey[] memory ks = pinnedKeys();
        for (uint256 i; i < ks.length; ++i) {
            (bytes memory data, bytes32 salt) = _pinOp(address(v3), ks[i]);
            uint256 ts = tl.getTimestamp(tl.hashOperation(address(v3), 0, data, bytes32(0), salt));
            if (ts == 1 || v3.pinned(keccak256(abi.encode(ks[i])))) continue; // done
            if (ts == 0) continue; // not scheduled (step 1 schedules every pin)
            if (block.timestamp < ts) {
                console2.log("WAIT: pin", i, "opens at unix time", ts);
                continue;
            }
            if (!_listed(v3, ks[i])) {
                console2.log("WAIT: pin", i, "needs its key registered on V3 first (keeper)");
                continue;
            }
            _safe(
                string.concat("pin ", vm.toString(i), " of the Stoa-owned pools"),
                LIVE_TIMELOCK,
                abi.encodeCall(TimelockController.execute, (address(v3), 0, data, bytes32(0), salt)),
                0
            );
            return true;
        }
    }

    function _opsV3(address v3a) internal view returns (Op memory a, Op memory b) {
        address[] memory ads = new address[](1);
        ads[0] = v3a;
        (a, b) = _ops(LIVE_ROUTER, ads);
        address[] memory t = new address[](2);
        uint256[] memory v = new uint256[](2);
        bytes[] memory p = new bytes[](2);
        (t[0], p[0]) = (b.targets[0], b.payloads[0]);
        (t[1], p[1]) = (LIVE_ROUTER, abi.encodeCall(StoaRouter.removeAdapter, (V4_V2)));
        (b.targets, b.values, b.payloads) = (t, v, p);
    }

    function _schedule(address v3a, Op memory a, Op memory b) internal {
        uint256 minDelay = tl.getMinDelay();
        PoolKey[] memory ks = pinnedKeys();
        bytes[] memory calls = new bytes[](2 + ks.length);
        calls[0] = abi.encodeCall(
            TimelockController.scheduleBatch, (a.targets, a.values, a.payloads, a.predecessor, a.salt, minDelay)
        );
        calls[1] = abi.encodeCall(
            TimelockController.scheduleBatch,
            (b.targets, b.values, b.payloads, b.predecessor, b.salt, minDelay + router.delay() + MARGIN)
        );
        for (uint256 i; i < ks.length; ++i) {
            (bytes memory data, bytes32 salt) = _pinOp(v3a, ks[i]);
            calls[2 + i] = abi.encodeCall(TimelockController.schedule, (v3a, 0, data, bytes32(0), salt, minDelay));
        }
        _safe(
            "step 1 of 3: schedule (router change and pins)",
            MULTISEND_CALL_ONLY,
            abi.encodeCall(IMultiSendLite.multiSend, (_pack(LIVE_TIMELOCK, calls))),
            1
        );
    }

    function _step2(Op memory a) internal {
        _safe(
            "step 2 of 3: propose",
            LIVE_TIMELOCK,
            abi.encodeCall(TimelockController.executeBatch, (a.targets, a.values, a.payloads, a.predecessor, a.salt)),
            0
        );
    }

    function _step3(address v3a, Op memory b, uint256 tsB) internal {
        uint256 eta = router.pending(router.proposalId(false, v3a));
        require(tsB > 1 && eta > 0, "unexpected state: check the timelock and router");
        uint256 ready = tsB > eta ? tsB : eta;
        if (block.timestamp < ready) return console2.log("WAIT: step 3 (swap adapters) opens at unix time", ready);
        _safe(
            "step 3 of 3: swap adapters",
            LIVE_TIMELOCK,
            abi.encodeCall(TimelockController.executeBatch, (b.targets, b.values, b.payloads, b.predecessor, b.salt)),
            0
        );
    }

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        require(vm.parseJsonAddress(vm.readFile("deployments/4663.json"), ".router") == LIVE_ROUTER, "router mismatch");
        address v3a = vm.parseJsonAddress(vm.readFile("deployments/4663-v4v3.json"), ".uniswapV4AdapterV3");
        UniswapV4AdapterV3 v3 = UniswapV4AdapterV3(payable(v3a));
        require(v3.owner() == LIVE_TIMELOCK && v3.stoaRouter() == LIVE_ROUTER, "V3 roles");
        safe = ISafeLite(LIVE_SAFE);
        bool swapped = router.isAdapter(v3a) && !router.isAdapter(V4_V2);
        if (!swapped && (!router.isAdapter(V4_V2) || router.isAdapter(V4_OLD))) {
            return console2.log("WAIT: UniswapV4AdapterV3 starts after the V4 fix (first adapter -> V2) is DONE");
        }
        _loadSigners();
        (Op memory a, Op memory b) = _opsV3(v3a);
        uint256 tsA = tl.getTimestamp(_id(a));
        console2.log("UniswapV4AdapterV3 - now", block.timestamp);
        if (tsA == 0) return _schedule(v3a, a, b);
        if (_pins(v3)) return; // one Safe transaction per run
        if (swapped) return console2.log("DONE: UniswapV4AdapterV3 is in the router and UniswapV4AdapterV2 is out.");
        if (tsA > 1) {
            if (block.timestamp < tsA) return console2.log("WAIT: step 2 (propose) opens at unix time", tsA);
            return _step2(a);
        }
        _step3(v3a, b, tl.getTimestamp(_id(b)));
    }
}
