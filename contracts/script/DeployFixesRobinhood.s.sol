// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {StoaLimitV2} from "../src/StoaLimitV2.sol";
import {UniswapV4AdapterV2} from "../src/adapters/UniswapV4AdapterV2.sol";
import {IPoolManager} from "../src/adapters/UniswapV4Adapter.sol";
import {TokenPackageRobinhood} from "./TokenPackageRobinhood.sol";
import {VenuesRobinhood} from "./VenuesRobinhood.sol";

/// @notice Deploys the fixes for the two findings Hey Research Lab reported in the independent security review
///         (16 Nov 2026) and writes deployments/4663-fixes.json (committed under contracts/, so no web build):
///         - StoaLimitV2: limit orders without the cap on open orders across all makers. Owner: the 48h timelock;
///           guardian and keeper as on StoaLimit. Live as soon as the web app and the keeper point at it.
///         - UniswapV4AdapterV2: only the keeper or the owner registers pool keys. Owner: the 48h timelock; keeper:
///           the keeper wallet. It routes nothing until the timelock adds it to the router and removes the old one
///           (script/RolloutV4FixRobinhood.s.sol, run by rollout-robinhood-venues.yml).
contract DeployFixesRobinhood is Script, TokenPackageRobinhood, VenuesRobinhood {
    address internal constant GUARDIAN = 0x5A63C75B38e7ee42220Cc3A57702E06D1D8903c9;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        string memory json = vm.readFile("deployments/4663.json");
        require(vm.parseJsonAddress(json, ".router") == LIVE_ROUTER, "router mismatch");
        require(vm.parseJsonAddress(json, ".timelock") == LIVE_TIMELOCK, "timelock mismatch");
        require(vm.parseJsonAddress(json, ".guardian") == GUARDIAN, "guardian mismatch");
        require(V4_POOL_MANAGER.code.length > 0, "no PoolManager");

        vm.startBroadcast();
        StoaLimitV2 lim = new StoaLimitV2(LIVE_TIMELOCK, StoaRouter(payable(LIVE_ROUTER)), GUARDIAN, KEEPER);
        UniswapV4AdapterV2 v4 =
            new UniswapV4AdapterV2(IPoolManager(V4_POOL_MANAGER), WETH, LIVE_ROUTER, LIVE_TIMELOCK, v4Hooks(), KEEPER);
        vm.stopBroadcast();

        require(lim.owner() == LIVE_TIMELOCK && lim.guardian() == GUARDIAN && lim.keeper() == KEEPER, "limit roles");
        require(address(lim.router()) == LIVE_ROUTER && !lim.paused(), "limit wiring");
        require(v4.owner() == LIVE_TIMELOCK && v4.keeper() == KEEPER, "v4 roles");
        require(address(v4.poolManager()) == V4_POOL_MANAGER && v4.whype() == WETH, "v4 wiring");
        require(v4.stoaRouter() == LIVE_ROUTER, "v4 router");
        address[] memory hooks = v4Hooks();
        for (uint256 i; i < hooks.length; ++i) {
            require(v4.hookAllowed(hooks[i]), "hook");
        }
        console2.log("StoaLimitV2", address(lim));
        console2.log("UniswapV4AdapterV2", address(v4));
        vm.serializeAddress("f", "limitV2", address(lim));
        vm.writeJson(vm.serializeAddress("f", "uniswapV4AdapterV2", address(v4)), "deployments/4663-fixes.json");
    }
}
