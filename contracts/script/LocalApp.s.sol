// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {MakerRegistry} from "../src/MakerRegistry.sol";
import {FeeDistributor} from "../src/FeeDistributor.sol";
import {StoaPool} from "../src/StoaPool.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {UniswapV2Adapter, IUniswapV2Factory} from "../src/adapters/UniswapV2Adapter.sol";
import {IMakerRegistry, IFeeDistributor} from "../src/interfaces/IStoa.sol";
import {MockToken, MockWHYPE, MockV2Factory} from "../test/mocks/Mocks.sol";

/// @notice Local stack for testing the web app: router-first (Uniswap V2 mock) plus an unquoted Stoa pool.
contract LocalApp is Script {
    function run() external {
        uint256 k = vm.envUint("DEPLOYER_KEY");
        address trader = vm.envAddress("TRADER");
        vm.startBroadcast(k);
        address me = vm.addr(k);
        MockWHYPE whype = new MockWHYPE();
        MockToken usdc = new MockToken("USDC", 6);
        MockToken meme = new MockToken("MEME", 18);
        MakerRegistry reg = new MakerRegistry(me, me, 1 days);
        FeeDistributor fees = new FeeDistributor(me, IMakerRegistry(address(reg)));
        StoaPool pool = new StoaPool(
            address(whype), address(usdc), IMakerRegistry(address(reg)), IFeeDistributor(address(fees)), me, 500e6
        );
        StoaRouter router = new StoaRouter(me, IFeeDistributor(address(fees)), address(whype), 1 hours);
        reg.listPool(address(pool), 10 ether);
        fees.setNotifier(address(router), true);
        router.addPool(address(pool));

        MockV2Factory v2 = new MockV2Factory();
        whype.deposit{value: 1_100 ether}();
        usdc.mint(me, 40_000e6);
        meme.mint(me, 1_000_000 ether);
        whype.approve(address(v2), type(uint256).max);
        usdc.approve(address(v2), type(uint256).max);
        meme.approve(address(v2), type(uint256).max);
        v2.addLiquidity(address(whype), address(usdc), 1_000 ether, 40_000e6);
        v2.addLiquidity(address(meme), address(whype), 1_000_000 ether, 100 ether);
        router.addAdapter(
            address(new UniswapV2Adapter(IUniswapV2Factory(address(v2)), address(whype), address(router)))
        );

        usdc.mint(trader, 2_000e6);
        vm.stopBroadcast();

        string memory o = "o";
        vm.serializeAddress(o, "whype", address(whype));
        vm.serializeAddress(o, "usdc", address(usdc));
        vm.serializeAddress(o, "meme", address(meme));
        vm.serializeAddress(o, "pool", address(pool));
        vm.serializeAddress(o, "fees", address(fees));
        string memory j = vm.serializeAddress(o, "router", address(router));
        vm.writeJson(j, "./localapp.json");
    }
}
