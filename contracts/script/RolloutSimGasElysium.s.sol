// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {UniswapV4AdapterV3} from "../src/adapters/UniswapV4AdapterV3.sol";
import {VenuePackageRobinhood} from "./VenuePackageRobinhood.sol";
import {SafeRunner, ISafeLite, IMultiSendLite} from "./SafeRunner.sol";

/// @notice The live Stoa deployment on Elysium (deployments/99901.json, web/lib/deployments.json): router after lockSetup (propose → 1-day
///         wait → execute), owned by a 48h TimelockController whose proposer and executor is the 2-of-3 admin Safe.
abstract contract ElysiumLive {
    address internal constant ELY_ROUTER = 0x104752D50ef893da579Ad813918269e09Ea17dbA;
    address internal constant ELY_SAFE = 0xBF715C84b1C0759C87Da368c1476b80ac0C5055F;
    address internal constant ELY_TIMELOCK = 0xeBa02cCc1f724Cd098fc20492EF9313e1ED2417B;
    address internal constant ELY_OLD_V3 = 0x3706B9467161B1c37915Df8f9B877Db60a9290F5;
    address internal constant ELY_OLD_AERO = 0x9C6c8c4fc598D46643b1c43D2660088F215C1fD8;
    address internal constant ELY_OLD_RAMSES = 0x78D5B6284D9D55b8c767571de2981259B66A548B;
    address internal constant ELY_OLD_V4 = 0xEB4BEC2795Ce314d1add4f8b3f2FCfBF38e892e5;
    /// Stoa's keeper on Elysium (the deployer): registered every key on the old V4 adapter
    address internal constant ELY_KEEPER = 0x056896d7d62fB4faE30f53d76CB55264f4c5c500;
}

/// @notice Swaps the Elysium router's Uniswap V3, Aero and Ramses adapters for their gas-capped V2s and its first
///         Uniswap V4 adapter for UniswapV4AdapterV3, one Safe step per call when due, the same three steps as
///         RolloutSimGasRobinhood:
///           1) schedule A (router.propose for the four new adapters) and B (router.execute for the four, plus
///              router.removeAdapter for the four old ones), one Safe tx
///           2) once A is ready: execute A (the router starts its 1-day wait)
///           3) once B and the router's wait are ready: execute B, so the new adapters go in and the old ones go out in
///              the same transaction (no gap in routing)
///         rollout-elysium-simgas.yml runs it hourly once deployments/99901-simgas.json exists. Step 3 waits until the
///         keeper has copied the old V4 adapter's keys onto V3 (each pair in script/data/v4-v3-seed-99901.json has a
///         key on V3), so V4 routing has no gap.
/// @dev Uses only the Op/_ops/_id helpers and the canonical MultiSendCallOnly address from VenuePackageRobinhood (the
///      same Safe v1.3.0 address is deployed on Elysium); every address it acts on is an Elysium one from ElysiumLive.
contract RolloutSimGasElysium is SafeRunner, VenuePackageRobinhood, ElysiumLive {
    StoaRouter constant elyRouter = StoaRouter(payable(ELY_ROUTER));
    TimelockController constant elyTl = TimelockController(payable(ELY_TIMELOCK));

    function _new() internal view returns (address[] memory ads) {
        string memory j = vm.readFile("deployments/99901-simgas.json");
        ads = new address[](4);
        ads[0] = vm.parseJsonAddress(j, ".uniswapV3AdapterV2");
        ads[1] = vm.parseJsonAddress(j, ".aeroAdapterV2");
        ads[2] = vm.parseJsonAddress(j, ".ramsesAdapterV2");
        ads[3] = vm.parseJsonAddress(j, ".uniswapV4AdapterV3");
    }

    /// @dev A and B as scheduled; exposed for tests and for the message to reviewers
    function ops() public view returns (Op memory a, Op memory b) {
        return opsFor(_new());
    }

    function opsFor(address[] memory ads) public pure returns (Op memory a, Op memory b) {
        (a, b) = _ops(ELY_ROUTER, ads);
        address[4] memory old = [ELY_OLD_V3, ELY_OLD_AERO, ELY_OLD_RAMSES, ELY_OLD_V4];
        uint256 n = b.targets.length;
        address[] memory t = new address[](n + 4);
        uint256[] memory v = new uint256[](n + 4);
        bytes[] memory p = new bytes[](n + 4);
        for (uint256 i; i < n; ++i) {
            (t[i], p[i]) = (b.targets[i], b.payloads[i]);
        }
        for (uint256 i; i < 4; ++i) {
            (t[n + i], p[n + i]) = (ELY_ROUTER, abi.encodeCall(StoaRouter.removeAdapter, (old[i])));
        }
        (b.targets, b.values, b.payloads) = (t, v, p);
    }

    /// @dev Pairs of the copied seed (the old V4 adapter's keys) with no key on V3 yet. A pair the keeper could not
    ///      register (a key V3 refuses) is fixed by hand before step 3: drop it from the seed or register it.
    function missingV4Keys(address v3) public view returns (uint256 missing) {
        string memory j = vm.readFile("script/data/v4-v3-seed-99901.json");
        UniswapV4AdapterV3 v4 = UniswapV4AdapterV3(payable(v3));
        for (uint256 i;; ++i) {
            string memory k = string.concat("[", vm.toString(i), "]");
            if (!vm.keyExistsJson(j, k)) break;
            address c0 = vm.parseJsonAddress(j, string.concat(k, ".currency0"));
            address c1 = vm.parseJsonAddress(j, string.concat(k, ".currency1"));
            if (v4.keysFor(c0 == address(0) ? v4.whype() : c0, c1).length == 0) ++missing;
        }
    }

    function run() external {
        require(block.chainid == 99901, "not Elysium");
        require(vm.parseJsonAddress(vm.readFile("deployments/99901.json"), ".router") == ELY_ROUTER, "router");
        address[] memory ads = _new();
        safe = ISafeLite(ELY_SAFE);
        bool done = !elyRouter.isAdapter(ELY_OLD_V3) && !elyRouter.isAdapter(ELY_OLD_AERO)
            && !elyRouter.isAdapter(ELY_OLD_RAMSES) && !elyRouter.isAdapter(ELY_OLD_V4);
        for (uint256 i; i < ads.length; ++i) {
            if (!elyRouter.isAdapter(ads[i])) done = false;
        }
        if (done) {
            console2.log("DONE: the gas-capped V3, Aero, Ramses and V4 adapters are in the Elysium router.");
            return;
        }
        _loadSigners();

        (Op memory a, Op memory b) = ops();
        uint256 tsA = elyTl.getTimestamp(_id(a));
        uint256 tsB = elyTl.getTimestamp(_id(b));
        console2.log("Elysium gas-capped adapters - now", block.timestamp);
        console2.log("operation A id");
        console2.logBytes32(_id(a));
        console2.log("operation B id");
        console2.logBytes32(_id(b));

        if (tsA == 0) {
            uint256 minDelay = elyTl.getMinDelay();
            bytes[] memory calls = new bytes[](2);
            calls[0] = abi.encodeCall(
                TimelockController.scheduleBatch, (a.targets, a.values, a.payloads, a.predecessor, a.salt, minDelay)
            );
            calls[1] = abi.encodeCall(
                TimelockController.scheduleBatch,
                (b.targets, b.values, b.payloads, b.predecessor, b.salt, minDelay + elyRouter.delay() + MARGIN)
            );
            _safe(
                "step 1 of 3: schedule",
                MULTISEND_CALL_ONLY,
                abi.encodeCall(IMultiSendLite.multiSend, (_pack(ELY_TIMELOCK, calls))),
                1
            );
        } else if (tsA > 1) {
            if (block.timestamp < tsA) return console2.log("WAIT: step 2 (propose) opens at unix time", tsA);
            _safe(
                "step 2 of 3: propose",
                ELY_TIMELOCK,
                abi.encodeCall(
                    TimelockController.executeBatch, (a.targets, a.values, a.payloads, a.predecessor, a.salt)
                ),
                0
            );
        } else {
            uint256 eta = elyRouter.pending(elyRouter.proposalId(false, ads[0]));
            require(tsB > 1 && eta > 0, "unexpected state: check the timelock and router");
            uint256 ready = tsB > eta ? tsB : eta;
            if (block.timestamp < ready) return console2.log("WAIT: step 3 (swap adapters) opens at unix time", ready);
            uint256 missing = missingV4Keys(ads[3]);
            if (missing > 0) {
                return console2.log("WAIT: step 3 waits for the keeper to copy V4 keys; pairs missing:", missing);
            }
            _safe(
                "step 3 of 3: swap adapters",
                ELY_TIMELOCK,
                abi.encodeCall(
                    TimelockController.executeBatch, (b.targets, b.values, b.payloads, b.predecessor, b.salt)
                ),
                0
            );
        }
    }
}
