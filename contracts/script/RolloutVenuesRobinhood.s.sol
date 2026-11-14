// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {VenuePackageRobinhood} from "./VenuePackageRobinhood.sol";

interface ISafeLite {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function isOwner(address) external view returns (bool);
    function nonce() external view returns (uint256);
    function approvedHashes(address owner, bytes32 hash) external view returns (uint256);
    function approveHash(bytes32 hash) external;
    function getTransactionHash(
        address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas,
        uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce_
    ) external view returns (bytes32);
    function execTransaction(
        address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas,
        uint256 gasPrice, address gasToken, address payable refundReceiver, bytes calldata signatures
    ) external payable returns (bool);
}

interface IMultiSendLite {
    function multiSend(bytes calldata transactions) external payable;
}

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
contract RolloutVenuesRobinhood is Script, VenuePackageRobinhood {
    StoaRouter constant router = StoaRouter(payable(LIVE_ROUTER));
    TimelockController constant tl = TimelockController(payable(LIVE_TIMELOCK));
    ISafeLite constant safe = ISafeLite(LIVE_SAFE);

    uint256[2] pk;
    address[2] who;
    uint256 nKeys;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
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

    function _loadSigners() internal {
        string[2] memory k = ["SIGNER1", "SIGNER2"];
        for (uint256 i; i < 2; ++i) {
            uint256 p = vm.envOr(string.concat(k[i], "_PK"), uint256(0));
            address w = p != 0 ? vm.addr(p) : vm.envOr(string.concat(k[i], "_ADDR"), address(0));
            if (w == address(0)) continue;
            require(safe.isOwner(w), string.concat(k[i], " is not a signer of the admin Safe"));
            pk[nKeys] = p;
            who[nKeys] = w;
            ++nKeys;
            console2.log("signer", w);
        }
        require(nKeys > 0, "no signer key: set SIGNER1_PK (and SIGNER2_PK)");
    }

    function _start(uint256 i) internal {
        if (pk[i] != 0) vm.startBroadcast(pk[i]);
        else vm.startBroadcast(who[i]);
    }

    /// approve on-chain with the keys we hold, then execute once the threshold is met; otherwise leave the approval
    function _safe(string memory label, address to, bytes memory data, uint8 op) internal {
        uint256 need = safe.getThreshold();
        bytes32 h = safe.getTransactionHash(to, 0, data, op, 0, 0, 0, address(0), address(0), safe.nonce());
        console2.log(label);
        console2.logBytes32(h);

        // owners that already approved this exact Safe transaction (from /admin or an earlier run)
        address[] memory owners = safe.getOwners();
        address[] memory ok = new address[](owners.length);
        uint256 n;
        for (uint256 i; i < owners.length; ++i) {
            if (safe.approvedHashes(owners[i], h) != 0) ok[n++] = owners[i];
        }
        uint256 extra; // our keys that have not approved yet
        for (uint256 i; i < nKeys; ++i) {
            if (!_has(ok, n, who[i])) ++extra;
        }
        if (n + extra < need) {
            for (uint256 i; i < nKeys; ++i) {
                if (_has(ok, n, who[i])) continue;
                _start(i);
                safe.approveHash(h);
                vm.stopBroadcast();
            }
            console2.log("APPROVED: waiting for one more signer (press the same step on stoadex.com/admin, Robinhood)");
            return;
        }

        // executor: one of our keys; everyone else in the signature set approves on-chain first if needed
        uint256 ex = nKeys - 1;
        address[] memory set = new address[](need);
        set[0] = who[ex];
        uint256 m = 1;
        for (uint256 i; i < n && m < need; ++i) {
            if (ok[i] != who[ex]) set[m++] = ok[i];
        }
        for (uint256 i; i < nKeys && m < need; ++i) {
            if (i == ex || _has(ok, n, who[i])) continue;
            _start(i);
            safe.approveHash(h);
            vm.stopBroadcast();
            set[m++] = who[i];
        }
        require(m == need, "not enough signers");
        _start(ex);
        bool done = safe.execTransaction(to, 0, data, op, 0, 0, 0, address(0), payable(address(0)), _sigs(set));
        vm.stopBroadcast();
        require(done, "Safe transaction failed");
        console2.log("EXECUTED:", label);
    }

    function _has(address[] memory list, uint256 n, address a) internal pure returns (bool) {
        for (uint256 i; i < n; ++i) {
            if (list[i] == a) return true;
        }
        return false;
    }

    /// "pre-approved" signatures (v = 1), sorted by owner address as Safe requires
    function _sigs(address[] memory set) internal pure returns (bytes memory s) {
        for (uint256 i; i < set.length; ++i) {
            for (uint256 j = i + 1; j < set.length; ++j) {
                if (set[j] < set[i]) (set[i], set[j]) = (set[j], set[i]);
            }
        }
        for (uint256 i; i < set.length; ++i) {
            s = abi.encodePacked(s, bytes32(uint256(uint160(set[i]))), bytes32(0), uint8(1));
        }
    }

    function _pack(address to, bytes[] memory calls) internal pure returns (bytes memory p) {
        for (uint256 i; i < calls.length; ++i) {
            p = abi.encodePacked(p, uint8(0), to, uint256(0), calls[i].length, calls[i]);
        }
    }
}
