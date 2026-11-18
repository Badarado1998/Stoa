// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {UniswapV4AdapterV3} from "../src/adapters/UniswapV4AdapterV3.sol";
import {VenueRollout} from "./RolloutVenuesRobinhood.s.sol";
import {ISafeLite, IMultiSendLite} from "./SafeRunner.sol";

/// @notice Puts the QHooks launch hooks on UniswapV4AdapterV3's hook allowlist through the Safe and the 48h timelock.
///         One timelock operation per hook, so either can be cancelled on its own, and the guardian can still take a
///         hook off the list at once (disableHook). One Safe transaction per run:
///           1) schedule every hook that is not scheduled yet (one Safe tx, MultiSend)
///           2) once an operation is ready: execute it (one per run)
///         Hooks (QSimpleLaunch, no owner, not upgradeable, source verified on Sourcify; quoted on chain 18 Nov 2026:
///         QHOOKS/WETH, 1% LP fee, tick spacing 200, 2% buy and sell tax, round trip -6.34% at 0.01 ETH):
///           - 0x0236...60cc: launch hook of QHOOKS/WETH
///           - 0x34ac...60cc: current QHooks launch hook (newer launches)
///         rollout-robinhood-venues.yml runs it every hour until both are allowed.
contract AllowHooksRobinhood is VenueRollout {
    bytes32 internal constant HOOK_SALT = keccak256("stoa.v4v3.hook");

    function hooks() internal pure returns (address[] memory h) {
        h = new address[](2);
        h[0] = 0x023623568f41c032EC2f4bBa368DBAFC123160CC;
        h[1] = 0x34ac8C4E6CA3D5B70A5321b648D0Db9451C060Cc;
    }

    function _op(address hook) internal pure returns (bytes memory data, bytes32 salt) {
        data = abi.encodeCall(UniswapV4AdapterV3.setHookAllowed, (hook, true));
        salt = keccak256(abi.encode(HOOK_SALT, hook));
    }

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        address v3a = vm.parseJsonAddress(vm.readFile("deployments/4663-v4v3.json"), ".uniswapV4AdapterV3");
        UniswapV4AdapterV3 v3 = UniswapV4AdapterV3(payable(v3a));
        require(v3.owner() == LIVE_TIMELOCK, "V3 owner is not the timelock");
        safe = ISafeLite(LIVE_SAFE);

        address[] memory h = hooks();
        uint256 n;
        bytes[] memory calls = new bytes[](h.length);
        uint256 minDelay = tl.getMinDelay();
        bool allDone = true;
        for (uint256 i; i < h.length; ++i) {
            if (v3.hookAllowed(h[i])) continue;
            allDone = false;
            (bytes memory data, bytes32 salt) = _op(h[i]);
            if (tl.getTimestamp(tl.hashOperation(v3a, 0, data, bytes32(0), salt)) == 0) {
                calls[n++] = abi.encodeCall(TimelockController.schedule, (v3a, 0, data, bytes32(0), salt, minDelay));
            }
        }
        if (allDone) return console2.log("DONE: QHooks hooks allowed on UniswapV4AdapterV3.");
        _loadSigners();
        console2.log("QHooks hooks - now", block.timestamp);

        if (n > 0) {
            bytes[] memory c = new bytes[](n);
            for (uint256 i; i < n; ++i) c[i] = calls[i];
            return _safe(
                "QHooks hooks: schedule",
                MULTISEND_CALL_ONLY,
                abi.encodeCall(IMultiSendLite.multiSend, (_pack(LIVE_TIMELOCK, c))),
                1
            );
        }
        for (uint256 i; i < h.length; ++i) {
            if (v3.hookAllowed(h[i])) continue;
            (bytes memory data, bytes32 salt) = _op(h[i]);
            uint256 ts = tl.getTimestamp(tl.hashOperation(v3a, 0, data, bytes32(0), salt));
            if (ts <= 1) continue; // cancelled or already executed
            if (block.timestamp < ts) {
                console2.log("WAIT: QHooks hook", i, "opens at unix time", ts);
                continue;
            }
            return _safe(
                string.concat("QHooks hook ", vm.toString(i), ": allow"),
                LIVE_TIMELOCK,
                abi.encodeCall(TimelockController.execute, (v3a, 0, data, bytes32(0), salt)),
                0
            );
        }
    }
}
