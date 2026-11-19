// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {VenuePackageRobinhood} from "./VenuePackageRobinhood.sol";
import {SafeRunner, ISafeLite, IMultiSendLite} from "./SafeRunner.sol";

/// @notice Cancels the held up. rollout in the 48h timelock: the propose (A) and execute (B) operations that would add
///         the original up. adapter 0xB408…56C3 to the live router. up. now goes in with the adapter update
///         (RolloutSimGasRobinhood). One Safe transaction (MultiSendCallOnly, two timelock.cancel calls);
///         cancelling has no delay. Skips any operation that is no longer pending, and checks each one still targets
///         the router with 0xB408 before cancelling it.
contract CancelUpRobinhood is SafeRunner, VenuePackageRobinhood {
    TimelockController constant tl = TimelockController(payable(LIVE_TIMELOCK));
    address constant OLD_UP = 0xB40892C77BC4A1ABA744C1afD96FCe048D6456C3;
    bytes32 constant OP_A = 0x2cd877be17ed8621f9ca63db39e16dad3166a45aac145f3d254a301aae8b60f6;
    bytes32 constant OP_B = 0x80c3a99111874dc471de0da4f1bac918dd6404f4054bbddd75d7c01bd8386570;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        // the ids are exactly what the up. rollout scheduled for OLD_UP (same helper the rollouts use)
        address[] memory ads = new address[](1);
        ads[0] = OLD_UP;
        (Op memory a, Op memory b) = _ops(LIVE_ROUTER, ads);
        require(_id(a) == OP_A, "op A is not the up. propose");
        require(_id(b) == OP_B, "op B is not the up. execute");
        bytes32[2] memory ids = [OP_A, OP_B];
        uint256 n;
        bytes[] memory calls = new bytes[](2);
        for (uint256 i; i < 2; ++i) {
            if (tl.isOperationPending(ids[i])) calls[n++] = abi.encodeCall(TimelockController.cancel, (ids[i]));
        }
        if (n == 0) {
            console2.log("DONE: both up. operations are cancelled.");
            return;
        }
        assembly {
            mstore(calls, n)
        }
        safe = ISafeLite(LIVE_SAFE);
        _loadSigners();
        _safe(
            "cancel the up. rollout (0xB408) in the timelock",
            MULTISEND_CALL_ONLY,
            abi.encodeCall(IMultiSendLite.multiSend, (_pack(LIVE_TIMELOCK, calls))),
            1
        );
        if (!tl.isOperationPending(OP_A) && !tl.isOperationPending(OP_B)) {
            console2.log("DONE: both up. operations are cancelled.");
        }
    }
}
