// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IUniswapV3Factory} from "../src/adapters/UniswapV3Adapter.sol";
import {UniswapV3AdapterV2Elysium as UniswapV3AdapterV2} from "../src/adapters/UniswapV3AdapterV2Elysium.sol";
import {ICLTickSpacingFactory} from "../src/adapters/CLTickSpacingAdapter.sol";
import {
    CLTickSpacingAdapterV2Elysium as CLTickSpacingAdapterV2
} from "../src/adapters/CLTickSpacingAdapterV2Elysium.sol";
import {UniswapV4AdapterV3} from "../src/adapters/UniswapV4AdapterV3.sol";
import {IPoolManager} from "../src/adapters/UniswapV4Adapter.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {VenuesElysium} from "./VenuesElysium.sol";
import {ElysiumLive} from "./RolloutSimGasElysium.s.sol";

/// @notice Deploys the gas-capped adapters (each pool's quote simulation capped at SIM_GAS, as on Robinhood Chain)
///         for the live Elysium router and writes deployments/99901-simgas.json:
///           - UniswapV3AdapterV2Elysium (Uniswap V3, hub WHYPE; SIM_GAS 1.5M): replaces UniswapV3Adapter 0x3706…90F5
///           - CLTickSpacingAdapterV2Elysium (SIM_GAS 1.5M) for Aero Slipstream and Ramses: replace 0x9C6c…1fD8 and 0x78D5…548B
///           - UniswapV4AdapterV3 (as on Robinhood Chain: keeper-only registration, no eviction, SIM_GAS per
///             simulation): replaces the first UniswapV4Adapter 0xEB4B…92e5, whose register() is open and evicts.
///             Owner the Elysium timelock, keeper Stoa's Elysium keeper (the deployer, which registered every key on
///             the old adapter), guardian the router's guardian, hooks the old adapter's allowlist (v4Hooks()).
///             The keeper copies the old adapter's keys onto it right after deployment (v4_copy_keys_elysium.py,
///             seed-v4.sh), days before the timelock can swap it in.
///         Same constructor arguments as the adapters they replace. No owner, no admin; nothing routes through them
///         until the timelock swaps them in (script/RolloutSimGasElysium.s.sol, run by rollout-elysium-simgas.yml).
contract DeploySimGasElysium is Script, VenuesElysium, ElysiumLive {
    function run() external {
        require(block.chainid == 99901, "not Elysium");
        require(vm.parseJsonAddress(vm.readFile("deployments/99901.json"), ".router") == ELY_ROUTER, "router");

        // the guardian is read from the live router, not from a file (as on Robinhood Chain, HEY Research Lab F-3)
        address guardian = StoaRouter(payable(ELY_ROUTER)).guardian();
        require(guardian != address(0), "guardian");
        vm.startBroadcast();
        UniswapV3AdapterV2 v3 = new UniswapV3AdapterV2(IUniswapV3Factory(UNI_V3_FACTORY), WHYPE, ELY_ROUTER);
        CLTickSpacingAdapterV2 aero =
            new CLTickSpacingAdapterV2(ICLTickSpacingFactory(AERO_CL_FACTORY), ELY_ROUTER, aeroSpacings());
        CLTickSpacingAdapterV2 ramses =
            new CLTickSpacingAdapterV2(ICLTickSpacingFactory(RAMSES_CL_FACTORY), ELY_ROUTER, ramsesSpacings());
        UniswapV4AdapterV3 v4 = new UniswapV4AdapterV3(
            IPoolManager(V4_POOL_MANAGER), WHYPE, ELY_ROUTER, ELY_TIMELOCK, v4Hooks(), ELY_KEEPER, guardian
        );
        vm.stopBroadcast();

        require(
            v4.owner() == ELY_TIMELOCK && v4.keeper() == ELY_KEEPER && v4.guardian() == guardian
                && v4.stoaRouter() == ELY_ROUTER && address(v4.poolManager()) == V4_POOL_MANAGER && v4.whype() == WHYPE,
            "v4 roles"
        );
        address[] memory hooks = v4Hooks();
        for (uint256 i; i < hooks.length; ++i) {
            require(v4.hookAllowed(hooks[i]), "v4 allowlist");
        }
        require(address(v3.factory()) == UNI_V3_FACTORY && v3.hub() == WHYPE && v3.stoaRouter() == ELY_ROUTER, "v3");
        require(address(aero.factory()) == AERO_CL_FACTORY && aero.stoaRouter() == ELY_ROUTER, "aero");
        require(address(ramses.factory()) == RAMSES_CL_FACTORY && ramses.stoaRouter() == ELY_ROUTER, "ramses");
        require(v3.SIM_GAS() == 1_500_000 && aero.SIM_GAS() == 1_500_000 && ramses.SIM_GAS() == 1_500_000, "cap");

        console2.log("UniswapV3AdapterV2Elysium", address(v3));
        console2.log("Aero CLTickSpacingAdapterV2Elysium", address(aero));
        console2.log("Ramses CLTickSpacingAdapterV2Elysium", address(ramses));
        console2.log("UniswapV4AdapterV3", address(v4));
        vm.serializeAddress("s", "uniswapV3AdapterV2", address(v3));
        vm.serializeAddress("s", "aeroAdapterV2", address(aero));
        vm.serializeAddress("s", "ramsesAdapterV2", address(ramses));
        vm.writeJson(vm.serializeAddress("s", "uniswapV4AdapterV3", address(v4)), "deployments/99901-simgas.json");
    }
}
