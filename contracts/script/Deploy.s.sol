// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MakerRegistry} from "../src/MakerRegistry.sol";
import {FeeDistributor} from "../src/FeeDistributor.sol";
import {StoaPool} from "../src/StoaPool.sol";
import {StoaRouter} from "../src/StoaRouter.sol";
import {IMakerRegistry, IFeeDistributor} from "../src/interfaces/IStoa.sol";
import {UniswapV2Adapter, IUniswapV2Router02} from "../src/adapters/UniswapV2Adapter.sol";

/// @notice Deploys Stoa v1 on Elysium (chain 99901) with the WHYPE/USDC pool.
/// Env: OWNER (multisig), TREASURY, CURATOR (pool owner), MAKER (bot address),
///      MIN_BOND (wei of HYPE), MAX_SWAP_USDC (raw, default 500e6), UNBOND_DELAY (seconds, default 1 day),
///      UNIV2_ROUTER (optional: Uniswap V2 router on Elysium; adds the fallback adapter)
/// Ownership note: the deployer configures everything, then hands ownership to OWNER (2-step: OWNER must accept).
contract Deploy is Script {
    address constant WHYPE = 0xbA876237B0F021A6c6D852d6c26E107997cC5E81;
    address constant USDC = 0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65;

    function run() external {
        require(block.chainid == 99901, "not Elysium");
        address owner = vm.envAddress("OWNER");
        address treasury = vm.envAddress("TREASURY");
        address curator = vm.envAddress("CURATOR");
        address maker = vm.envAddress("MAKER");
        uint256 minBond = vm.envUint("MIN_BOND");
        uint256 maxSwap = vm.envOr("MAX_SWAP_USDC", uint256(500e6));
        uint64 unbondDelay = uint64(vm.envOr("UNBOND_DELAY", uint256(1 days)));

        vm.startBroadcast();
        address me = msg.sender;
        MakerRegistry reg = new MakerRegistry(me, treasury, unbondDelay);
        FeeDistributor fees = new FeeDistributor(me, IMakerRegistry(address(reg)));
        StoaPool pool =
            new StoaPool(WHYPE, USDC, IMakerRegistry(address(reg)), IFeeDistributor(address(fees)), curator, maxSwap);
        StoaRouter router = new StoaRouter(me, IFeeDistributor(address(fees)), WHYPE);

        reg.listPool(address(pool), minBond);
        reg.setMakerApproval(address(pool), maker, true);
        fees.setNotifier(address(router), true);
        router.addPool(address(pool));
        address v2 = vm.envOr("UNIV2_ROUTER", address(0));
        if (v2 != address(0)) {
            UniswapV2Adapter ad = new UniswapV2Adapter(IUniswapV2Router02(v2), WHYPE, address(router));
            router.addAdapter(address(ad));
            console2.log("UniswapV2Adapter", address(ad));
        }

        reg.transferOwnership(owner);
        fees.transferOwnership(owner);
        router.transferOwnership(owner);
        vm.stopBroadcast();

        console2.log("MakerRegistry ", address(reg));
        console2.log("FeeDistributor", address(fees));
        console2.log("StoaPool      ", address(pool));
        console2.log("StoaRouter    ", address(router));
    }
}
