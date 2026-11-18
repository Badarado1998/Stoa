// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IUniswapV3Factory} from "../src/adapters/UniswapV3Adapter.sol";
import {UniswapV3AdapterV2} from "../src/adapters/UniswapV3AdapterV2.sol";
import {ICLTickSpacingFactory} from "../src/adapters/CLTickSpacingAdapter.sol";
import {CLTickSpacingAdapterV2} from "../src/adapters/CLTickSpacingAdapterV2.sol";
import {VenuesElysium} from "./VenuesElysium.sol";
import {ElysiumLive} from "./RolloutSimGasElysium.s.sol";

/// @notice Deploys the gas-capped adapters (each pool's quote simulation capped at SIM_GAS, as on Robinhood Chain)
///         for the live Elysium router and writes deployments/99901-simgas.json:
///           - UniswapV3AdapterV2 (Uniswap V3, hub WHYPE): replaces UniswapV3Adapter 0x3706…90F5
///           - CLTickSpacingAdapterV2 for Aero Slipstream and Ramses: replace 0x9C6c…1fD8 and 0x78D5…548B
///         Same constructor arguments as the adapters they replace. No owner, no admin; nothing routes through them
///         until the timelock swaps them in (script/RolloutSimGasElysium.s.sol, run by rollout-elysium-simgas.yml).
contract DeploySimGasElysium is Script, VenuesElysium, ElysiumLive {
    function run() external {
        require(block.chainid == 99901, "not Elysium");
        require(vm.parseJsonAddress(vm.readFile("deployments/99901.json"), ".router") == ELY_ROUTER, "router");

        vm.startBroadcast();
        UniswapV3AdapterV2 v3 = new UniswapV3AdapterV2(IUniswapV3Factory(UNI_V3_FACTORY), WHYPE, ELY_ROUTER);
        CLTickSpacingAdapterV2 aero =
            new CLTickSpacingAdapterV2(ICLTickSpacingFactory(AERO_CL_FACTORY), ELY_ROUTER, aeroSpacings());
        CLTickSpacingAdapterV2 ramses =
            new CLTickSpacingAdapterV2(ICLTickSpacingFactory(RAMSES_CL_FACTORY), ELY_ROUTER, ramsesSpacings());
        vm.stopBroadcast();

        require(address(v3.factory()) == UNI_V3_FACTORY && v3.hub() == WHYPE && v3.stoaRouter() == ELY_ROUTER, "v3");
        require(address(aero.factory()) == AERO_CL_FACTORY && aero.stoaRouter() == ELY_ROUTER, "aero");
        require(address(ramses.factory()) == RAMSES_CL_FACTORY && ramses.stoaRouter() == ELY_ROUTER, "ramses");
        require(v3.SIM_GAS() == 1_000_000 && aero.SIM_GAS() == 1_000_000 && ramses.SIM_GAS() == 1_000_000, "cap");

        console2.log("UniswapV3AdapterV2", address(v3));
        console2.log("Aero CLTickSpacingAdapterV2", address(aero));
        console2.log("Ramses CLTickSpacingAdapterV2", address(ramses));
        vm.serializeAddress("s", "uniswapV3AdapterV2", address(v3));
        vm.serializeAddress("s", "aeroAdapterV2", address(aero));
        vm.writeJson(vm.serializeAddress("s", "ramsesAdapterV2", address(ramses)), "deployments/99901-simgas.json");
    }
}
