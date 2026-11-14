// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {FeeDistributor} from "../src/FeeDistributor.sol";
import {StoaBuyback} from "../src/StoaBuyback.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {TokenPackageRobinhood} from "./TokenPackageRobinhood.sol";

/// @notice Deploys the $STOA utility contracts on Robinhood Chain, both owned by the 48h timelock:
///         - StoaBuyback: becomes the FeeDistributor's owner through the timelock (RolloutBuybackRobinhood), then
///           protocol fees can only buy $STOA and burn it
///         - BondRegistry: makers bond $STOA to quote Stoa maker pools; slashed bonds are burned
///         Writes deployments/4663-token.json; the workflow merges it into web/lib/deployments-4663.json.
contract DeployTokenUtilityRobinhood is Script, TokenPackageRobinhood {
    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        string memory json = vm.readFile("deployments/4663.json");
        require(vm.parseJsonAddress(json, ".router") == LIVE_ROUTER, "router mismatch");
        require(vm.parseJsonAddress(json, ".feeDistributor") == LIVE_FEES, "fee distributor mismatch");
        require(vm.parseJsonAddress(json, ".timelock") == LIVE_TIMELOCK, "timelock mismatch");

        vm.startBroadcast();
        StoaBuyback bb = new StoaBuyback(
            LIVE_TIMELOCK, FeeDistributor(LIVE_FEES), StoaRouter(payable(LIVE_ROUTER)), IERC20(STOA), KEEPER
        );
        BondRegistry reg = new BondRegistry(LIVE_TIMELOCK, IERC20(STOA), BOND_UNBOND_DELAY);
        vm.stopBroadcast();

        require(bb.owner() == LIVE_TIMELOCK && reg.owner() == LIVE_TIMELOCK, "owner");
        console2.log("StoaBuyback ", address(bb));
        console2.log("BondRegistry", address(reg));
        vm.serializeAddress("t", "stoaBuyback", address(bb));
        vm.serializeAddress("t", "bondRegistry", address(reg));
        vm.writeJson(vm.serializeAddress("t", "stoa", STOA), "deployments/4663-token.json");
    }
}
