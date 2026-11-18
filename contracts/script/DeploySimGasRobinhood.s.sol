// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IUniswapV3Factory} from "../src/adapters/UniswapV3Adapter.sol";
import {UniswapV3AdapterV2} from "../src/adapters/UniswapV3AdapterV2.sol";
import {ICLTickSpacingFactory} from "../src/adapters/CLTickSpacingAdapter.sol";
import {CLTickSpacingAdapterV2} from "../src/adapters/CLTickSpacingAdapterV2.sol";
import {VenuesRobinhood} from "./VenuesRobinhood.sol";
import {UpVenueRobinhood} from "./UpVenueRobinhood.sol";
import {VenuePackageRobinhood} from "./VenuePackageRobinhood.sol";

/// @notice Deploys the gas-capped adapters (each pool's quote simulation capped at SIM_GAS, as in UniswapV4AdapterV3)
///         for the live Robinhood Chain router and writes deployments/4663-simgas.json:
///           - UniswapV3AdapterV2 (Uniswap V3, hub WETH): replaces UniswapV3Adapter 0x2880…A2E6
///           - CLTickSpacingAdapterV2 for Aero Slipstream and Ramses: replace 0xF090…9352 and 0x87b3…d568
///           - CLTickSpacingAdapterV2 for up.: added instead of the held 0xB408…56C3
///         Same constructor arguments as the adapters they replace. No owner, no admin; nothing routes through them
///         until the timelock adds them (script/RolloutSimGasRobinhood.s.sol, run by rollout-robinhood-venues.yml).
contract DeploySimGasRobinhood is Script, VenuesRobinhood, UpVenueRobinhood, VenuePackageRobinhood {
    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        require(vm.parseJsonAddress(vm.readFile("deployments/4663.json"), ".router") == LIVE_ROUTER, "router mismatch");

        vm.startBroadcast();
        UniswapV3AdapterV2 v3 = new UniswapV3AdapterV2(IUniswapV3Factory(UNI_V3_FACTORY), WETH, LIVE_ROUTER);
        CLTickSpacingAdapterV2 aero =
            new CLTickSpacingAdapterV2(ICLTickSpacingFactory(AERO_CL_FACTORY), LIVE_ROUTER, aeroSpacings());
        CLTickSpacingAdapterV2 ramses =
            new CLTickSpacingAdapterV2(ICLTickSpacingFactory(RAMSES_CL_FACTORY), LIVE_ROUTER, ramsesSpacings());
        CLTickSpacingAdapterV2 up =
            new CLTickSpacingAdapterV2(ICLTickSpacingFactory(UP_CL_FACTORY), LIVE_ROUTER, upSpacings());
        vm.stopBroadcast();

        require(address(v3.factory()) == UNI_V3_FACTORY && v3.hub() == WETH && v3.stoaRouter() == LIVE_ROUTER, "v3");
        require(address(aero.factory()) == AERO_CL_FACTORY && aero.stoaRouter() == LIVE_ROUTER, "aero");
        require(address(ramses.factory()) == RAMSES_CL_FACTORY && ramses.stoaRouter() == LIVE_ROUTER, "ramses");
        require(address(up.factory()) == UP_CL_FACTORY && up.stoaRouter() == LIVE_ROUTER, "up");
        require(v3.SIM_GAS() == 1_000_000 && aero.SIM_GAS() == 1_000_000, "cap");

        console2.log("UniswapV3AdapterV2", address(v3));
        console2.log("Aero CLTickSpacingAdapterV2", address(aero));
        console2.log("Ramses CLTickSpacingAdapterV2", address(ramses));
        console2.log("up. CLTickSpacingAdapterV2", address(up));
        vm.serializeAddress("s", "uniswapV3AdapterV2", address(v3));
        vm.serializeAddress("s", "aeroAdapterV2", address(aero));
        vm.serializeAddress("s", "ramsesAdapterV2", address(ramses));
        vm.writeJson(vm.serializeAddress("s", "upAdapterV2", address(up)), "deployments/4663-simgas.json");
    }
}
