// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {UniswapV4AdapterV3} from "../src/adapters/UniswapV4AdapterV3.sol";
import {IPoolManager} from "../src/adapters/UniswapV4Adapter.sol";
import {TokenPackageRobinhood} from "./TokenPackageRobinhood.sol";
import {VenuesRobinhood} from "./VenuesRobinhood.sol";

/// @notice DRAFT, not deployed. Deploys UniswapV4AdapterV3 on Robinhood Chain: owner the 48h timelock, keeper Stoa's
///         keeper, hooks = the V2 adapter's allowlist plus the three Fables hooks (FablesRamp, FablesRampETH,
///         FablesRWA), and writes deployments/4663-v4v3.json. The router only uses it after the timelock adds it
///         (and removes UniswapV4AdapterV2). Needs an independent review and the owner's yes before any broadcast.
///         Guardian = the router's guardian (may take a hook off the list at once, never put one on).
///         Rollout (Hey Research Lab's notes): register the canonical $STOA pool first and schedule its pin as a
///         separate timelock operation, since setPinned reverts unless the key is registered when it runs. V3 is bound
///         to the live router (v1); StoaRouterV2 needs its own V3 copy with its own pins.
contract DeployV4AdapterV3Robinhood is Script, TokenPackageRobinhood, VenuesRobinhood {
    address internal constant GUARDIAN = 0x5A63C75B38e7ee42220Cc3A57702E06D1D8903c9;

    function hooksV3() internal pure returns (address[] memory h) {
        address[] memory base = v4Hooks();
        h = new address[](base.length + 3);
        for (uint256 i; i < base.length; ++i) {
            h[i] = base[i];
        }
        h[base.length] = 0x08E52564Bad99E05a694b4809F397edcA417A080; // FablesRamp
        h[base.length + 1] = 0x594e8e6281eDf2d363a0293a50004Cf868E7a080; // FablesRampETH
        h[base.length + 2] = 0x5Eb87F69bE00Df39981622Fd60A8De4b7837e080; // FablesRWA
    }

    function run() external {
        require(block.chainid == 4663, "Robinhood Chain only");
        require(
            vm.parseJsonAddress(vm.readFile("../web/lib/deployments-4663.json"), ".guardian") == GUARDIAN,
            "guardian mismatch"
        );
        vm.startBroadcast();
        UniswapV4AdapterV3 v4 = new UniswapV4AdapterV3(
            IPoolManager(V4_POOL_MANAGER), WETH, LIVE_ROUTER, LIVE_TIMELOCK, hooksV3(), KEEPER, GUARDIAN
        );
        vm.stopBroadcast();
        console2.log("UniswapV4AdapterV3", address(v4));
        vm.writeJson(vm.serializeAddress("v", "uniswapV4AdapterV3", address(v4)), "deployments/4663-v4v3.json");
    }
}
