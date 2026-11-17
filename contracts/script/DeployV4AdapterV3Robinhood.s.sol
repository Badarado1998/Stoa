// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {UniswapV4AdapterV3} from "../src/adapters/UniswapV4AdapterV3.sol";
import {IPoolManager} from "../src/adapters/UniswapV4Adapter.sol";
import {TokenPackageRobinhood} from "./TokenPackageRobinhood.sol";
import {V4AdapterV3Robinhood} from "./V4AdapterV3Robinhood.sol";

/// @notice Prepared, NOT deployed: deploy-robinhood-v4v3.yml runs it only after Hey Research Lab's go on the fixes
///         (1111e9a, 109b08b) and the owner's yes. Deploys UniswapV4AdapterV3 on Robinhood Chain: owner the 48h timelock, keeper Stoa's
///         keeper, hooks = the V2 adapter's allowlist plus the three Fables hooks (FablesRamp, FablesRampETH,
///         FablesRWA), and writes deployments/4663-v4v3.json. The router only uses it after the timelock adds it
///         (and removes UniswapV4AdapterV2). Then RolloutV4AdapterV3Robinhood.s.sol takes it in.
///         Guardian = the router's guardian (may take a hook off the list at once, never put one on).
///         Rollout (Hey Research Lab's notes): register the canonical $STOA pool first and schedule its pin as a
///         separate timelock operation, since setPinned reverts unless the key is registered when it runs. V3 is bound
///         to the live router (v1); StoaRouterV2 needs its own V3 copy with its own pins.
///         Before the Safe schedules the router change (Hey Research Lab review, I-4): check the deployment's nine
///         HookSet events against hooksV3() and owner/keeper/guardian/stoaRouter/poolManager/whype; add the Fables
///         hooks to ALLOW in script/data/v4_top_pools.py; point v4_guard.py and route-check.sh at V3 and watch PinSet,
///         HookSet, KeeperSet and GuardianSet.
contract DeployV4AdapterV3Robinhood is Script, TokenPackageRobinhood, V4AdapterV3Robinhood {
    function run() external {
        require(block.chainid == 4663, "Robinhood Chain only");
        require(
            vm.parseJsonAddress(vm.readFile("deployments/4663.json"), ".guardian") == V3_GUARDIAN, "guardian mismatch"
        );
        address[] memory hooks = hooksV3();
        vm.startBroadcast();
        UniswapV4AdapterV3 v4 = new UniswapV4AdapterV3(
            IPoolManager(V4_POOL_MANAGER), WETH, LIVE_ROUTER, LIVE_TIMELOCK, hooks, KEEPER, V3_GUARDIAN
        );
        vm.stopBroadcast();
        // the roles and the allowlist are what the rollout and the review assume (Hey Research Lab, I-4); the
        // workflow also counts the HookSet events of the deployment transaction
        require(
            v4.owner() == LIVE_TIMELOCK && v4.keeper() == KEEPER && v4.guardian() == V3_GUARDIAN
                && v4.stoaRouter() == LIVE_ROUTER && address(v4.poolManager()) == V4_POOL_MANAGER && v4.whype() == WETH,
            "roles"
        );
        for (uint256 i; i < hooks.length; ++i) {
            require(v4.hookAllowed(hooks[i]), "allowlist");
        }
        console2.log("UniswapV4AdapterV3", address(v4));
        vm.serializeUint("v", "block", block.number);
        vm.serializeUint("v", "hooks", hooks.length);
        vm.writeJson(vm.serializeAddress("v", "uniswapV4AdapterV3", address(v4)), "deployments/4663-v4v3.json");
    }
}
