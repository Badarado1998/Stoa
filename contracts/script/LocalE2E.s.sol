// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MakerRegistry} from "../src/MakerRegistry.sol";
import {FeeDistributor} from "../src/FeeDistributor.sol";
import {StoaPool} from "../src/StoaPool.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {IMakerRegistry, IFeeDistributor} from "../src/interfaces/IStoa.sol";
import {MockToken} from "../test/mocks/Mocks.sol";

/// @notice Local end-to-end setup on anvil: mock WHYPE/USDC, full Stoa stack, bonded maker, funded trader.
contract LocalE2E is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        uint256 makerKey = vm.envUint("MAKER_KEY");
        address maker = vm.addr(makerKey);
        address trader = vm.envAddress("TRADER");

        vm.startBroadcast(deployerKey);
        address me = vm.addr(deployerKey);
        MockToken whype = new MockToken("WHYPE", 18);
        MockToken usdc = new MockToken("USDC", 6);
        MakerRegistry reg = new MakerRegistry(me, me, 1 days);
        FeeDistributor fees = new FeeDistributor(me, IMakerRegistry(address(reg)));
        StoaPool pool = new StoaPool(
            address(whype), address(usdc), IMakerRegistry(address(reg)), IFeeDistributor(address(fees)), me, 500e6
        );
        StoaRouter router = new StoaRouter(me, IFeeDistributor(address(fees)), address(whype));
        reg.listPool(address(pool), 10 ether);
        reg.setMakerApproval(address(pool), maker, true);
        fees.setNotifier(address(router), true);
        router.addPool(address(pool));
        whype.mint(address(pool), 20 ether);
        usdc.mint(address(pool), 1_500e6);
        whype.mint(trader, 50 ether);
        usdc.mint(trader, 5_000e6);
        vm.stopBroadcast();

        vm.startBroadcast(makerKey);
        reg.bond{value: 20 ether}(address(pool));
        vm.stopBroadcast();

        string memory o = "o";
        vm.serializeAddress(o, "whype", address(whype));
        vm.serializeAddress(o, "usdc", address(usdc));
        vm.serializeAddress(o, "pool", address(pool));
        vm.serializeAddress(o, "fees", address(fees));
        string memory json = vm.serializeAddress(o, "router", address(router));
        vm.writeJson(json, "./e2e.json");
        console2.log("pool", address(pool));
    }
}
